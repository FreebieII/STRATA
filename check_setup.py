"""Check that STRATA is set up correctly. It never places an order.

    python check_setup.py             check Python, packages, config.yaml and .env
                                      (works offline)
    python check_setup.py --connect   also log in to your Alpaca PAPER account and
                                      fetch a few recent prices (read-only)

Each check prints [ OK ], [WARN] or [FAIL]. Your keys are never printed.
The exit code is 0 when nothing failed and 1 otherwise.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIN_PYTHON = (3, 11)

OK, WARN, FAIL = "OK", "WARN", "FAIL"
_TAGS = {OK: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]"}


@dataclass
class Check:
    status: str
    name: str
    detail: str = ""

    def line(self) -> str:
        return f"{_TAGS[self.status]} {self.name}" + (f": {self.detail}" if self.detail else "")


# ---------------------------------------------------------------------------
# Offline checks
# ---------------------------------------------------------------------------


def check_python(version: tuple[int, ...] = tuple(sys.version_info[:3])) -> Check:
    shown = ".".join(map(str, version))
    if version[:2] >= MIN_PYTHON:
        return Check(OK, "Python", shown)
    wanted = ".".join(map(str, MIN_PYTHON))
    return Check(FAIL, "Python", f"{shown} is too old; install Python {wanted} or newer")


def pinned_requirements(path: Path = ROOT / "requirements.txt") -> dict[str, str]:
    """{package: version} for every 'name==version' line in requirements.txt."""
    pins = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        match = re.fullmatch(r"([A-Za-z0-9_.\-]+)==([A-Za-z0-9_.\-]+)", line)
        if match:
            pins[match.group(1)] = match.group(2)
    return pins


def check_packages() -> list[Check]:
    problems, fine = [], 0
    for name, wanted in pinned_requirements().items():
        try:
            installed = metadata.version(name)
        except metadata.PackageNotFoundError:
            problems.append(
                Check(FAIL, f"package {name}", "not installed. Run: pip install -r requirements.txt")
            )
            continue
        if installed != wanted:
            problems.append(
                Check(
                    WARN,
                    f"package {name}",
                    f"{installed} installed but {wanted} expected. "
                    "Run: pip install -r requirements.txt",
                )
            )
        else:
            fine += 1
    if fine:
        problems.insert(0, Check(OK, "packages", f"{fine} installed at the expected versions"))
    return problems


def check_config(path: Path):
    from strata.config import ConfigError, load_config

    try:
        config = load_config(path)
    except ConfigError as exc:
        return [Check(FAIL, "config.yaml", str(exc))], None

    r = config.risk
    risk = (
        f"MAX_CAPITAL ${r.MAX_CAPITAL:,.2f}, largest position ${r.max_position_value:,.2f}, "
        f"stop loss {r.STOP_LOSS_PCT:g}%, daily loss limit ${r.DAILY_LOSS_LIMIT:,.2f}, "
        f"total loss limit ${r.TOTAL_LOSS_LIMIT:,.2f}, max {r.MAX_TRADES_PER_DAY} trades/day"
    )
    instruments = ", ".join(
        f"{i.symbol} ({i.asset_class}, {i.strategy}{'' if i.enabled else ', DISABLED'})"
        for i in config.instruments
    )
    checks = [
        Check(OK, "config.yaml", "every setting is valid"),
        Check(OK, "risk limits", risk),
        Check(OK, "instruments", instruments),
    ]
    if not config.enabled_instruments:
        checks.append(Check(WARN, "instruments", "none is enabled, so the bot won't trade"))
    return checks, config


def check_env(path: Path):
    from strata.credentials import (
        LIVE_KEY_NAMES,
        CredentialsError,
        live_trading_switch_on,
        load_paper_keys,
        looks_like_paper_key,
        read_env_file,
        secret_values,
    )
    from strata.logging_setup import register_secrets

    try:
        env = read_env_file(path)
    except CredentialsError as exc:
        return [Check(FAIL, ".env", str(exc))], None
    register_secrets(*secret_values(env))

    checks = [Check(OK, ".env", "found and readable")]
    try:
        keys = load_paper_keys(env)
    except CredentialsError as exc:
        checks.append(Check(FAIL, "paper keys", str(exc)))
    else:
        if looks_like_paper_key(keys.api_key):
            checks.append(Check(OK, "paper keys", "filled in (not shown)"))
        else:
            checks.append(
                Check(
                    WARN,
                    "paper keys",
                    "filled in, but Alpaca paper key IDs usually start with 'PK'. "
                    "Check that you copied the PAPER key, not a live one.",
                )
            )

    if live_trading_switch_on(env):
        checks.append(
            Check(
                WARN,
                "LIVE_TRADING",
                "is true, so live mode is unlocked in .env. Set it back to false "
                "until you have finished the go-live checklist in README.md.",
            )
        )
    else:
        checks.append(Check(OK, "LIVE_TRADING", "off, so live mode is locked"))

    if any(env.get(name) for name in LIVE_KEY_NAMES):
        checks.append(
            Check(WARN, "live keys", "are filled in. Leave them empty until you are ready to go live.")
        )
    else:
        checks.append(Check(OK, "live keys", "empty, as they should be until you go live"))
    return checks, env


def check_env_not_in_git(root: Path = ROOT) -> Check:
    name = ".env and git"
    try:
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", ".env"], cwd=root, capture_output=True
        )
        ignored = subprocess.run(["git", "check-ignore", "-q", ".env"], cwd=root, capture_output=True)
    except OSError:
        return Check(WARN, name, "git isn't installed, so this couldn't be checked")
    if tracked.returncode == 0:
        return Check(
            FAIL,
            name,
            ".env is COMMITTED to git. Run 'git rm --cached .env', commit, then create "
            "NEW keys in Alpaca: the old ones may have been exposed.",
        )
    if ignored.returncode == 0:
        return Check(OK, name, "git ignores .env, so it can't be committed by accident")
    if ignored.returncode == 1:
        return Check(FAIL, name, ".env is NOT ignored by git. Add a line '.env' to .gitignore.")
    return Check(WARN, name, "this folder isn't a git repository, so this couldn't be checked")


# ---------------------------------------------------------------------------
# Online checks (--connect): read-only calls to the PAPER account
# ---------------------------------------------------------------------------


def check_connection(config, env) -> list[Check]:
    from strata.alpaca_clients import trading_client
    from strata.credentials import load_paper_keys

    keys = load_paper_keys(env)
    client = trading_client(keys)  # paper keys always go to the paper server
    try:
        account = client.get_account()
    except Exception as exc:  # any failure is reported in plain words
        return [Check(FAIL, "paper account", describe_error(exc))]

    checks = []
    status = getattr(account.status, "value", account.status)
    blocked = [
        flag
        for flag in ("trading_blocked", "account_blocked", "trade_suspended_by_user")
        if getattr(account, flag, False)
    ]
    if status != "ACTIVE" or blocked:
        checks.append(
            Check(FAIL, "paper account", f"status {status}; blocked: {', '.join(blocked) or 'no'}")
        )
    else:
        cash = float(account.cash or 0)
        checks.append(
            Check(OK, "paper account", f"logged in, status ACTIVE, fake-money cash ${cash:,.2f}")
        )

    if any(i.asset_class == "crypto" for i in config.enabled_instruments):
        crypto_status = getattr(account.crypto_status, "value", account.crypto_status)
        if crypto_status == "ACTIVE":
            checks.append(Check(OK, "crypto trading", "enabled on this account"))
        else:
            checks.append(
                Check(FAIL, "crypto trading", f"status {crypto_status}; enable crypto in Alpaca")
            )

    if account.pattern_day_trader:
        checks.append(Check(WARN, "day trading", "this account is flagged as a pattern day trader"))
    else:
        count = account.daytrade_count if account.daytrade_count is not None else "unknown"
        checks.append(Check(OK, "day trading", f"not flagged; day trades in last 5 days: {count}"))

    try:
        clock = client.get_clock()
        state = "OPEN" if clock.is_open else "closed"
        checks.append(
            Check(OK, "market clock", f"US stock market is {state}; next open {clock.next_open}")
        )
    except Exception as exc:
        checks.append(Check(FAIL, "market clock", describe_error(exc)))

    for instrument in config.enabled_instruments:
        checks.extend(_check_instrument(client, keys, config, instrument))
    return checks


def _check_instrument(client, keys, config, instrument) -> list[Check]:
    from alpaca.data.enums import DataFeed
    from alpaca.data.requests import CryptoBarsRequest, StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    from strata.alpaca_clients import crypto_data_client, stock_data_client

    symbol = instrument.symbol
    try:
        asset = client.get_asset(symbol)
    except Exception as exc:
        return [Check(FAIL, symbol, f"couldn't look it up: {describe_error(exc)}")]
    if not asset.tradable:
        return [Check(FAIL, symbol, "Alpaca says it isn't tradable")]

    now = datetime.now(timezone.utc)
    start = now - timedelta(days=10)
    end = now - timedelta(minutes=20)  # free data plans can't fetch the newest 15 minutes
    price = None
    checks = []
    try:
        if instrument.asset_class == "stock":
            request = StockBarsRequest(
                symbol_or_symbols=symbol,
                timeframe=TimeFrame.Day,
                start=start,
                end=end,
                feed=DataFeed(config.data.historical_stock_feed),
            )
            bars = stock_data_client(keys).get_stock_bars(request).data.get(symbol, [])
        else:
            request = CryptoBarsRequest(
                symbol_or_symbols=symbol, timeframe=TimeFrame.Day, start=start, end=end
            )
            bars = crypto_data_client(keys).get_crypto_bars(request).data.get(symbol, [])
    except Exception as exc:
        hint = ""
        if instrument.asset_class == "stock" and config.data.historical_stock_feed == "sip":
            hint = " (if this is a permissions error, try historical_stock_feed: iex in config.yaml)"
        checks.append(Check(FAIL, f"{symbol} prices", describe_error(exc) + hint))
    else:
        if bars:
            last = bars[-1]
            price = last.close
            checks.append(
                Check(
                    OK,
                    f"{symbol} prices",
                    f"{len(bars)} daily bars, last close ${last.close:,.2f} on {last.timestamp:%Y-%m-%d}",
                )
            )
        else:
            checks.append(Check(FAIL, f"{symbol} prices", "no recent daily prices came back"))

    largest = config.risk.max_position_value
    if instrument.asset_class == "stock":
        if asset.fractionable:
            checks.append(Check(OK, f"{symbol} size", "fractional shares allowed"))
        elif price is not None and price > largest:
            checks.append(
                Check(
                    FAIL,
                    f"{symbol} size",
                    f"one share costs ${price:,.2f}, more than the ${largest:,.2f} position "
                    "limit, and fractional shares aren't available",
                )
            )
        else:
            checks.append(Check(WARN, f"{symbol} size", "whole shares only"))
    elif asset.min_order_size and price is not None:
        smallest = asset.min_order_size * price
        status = OK if smallest <= largest else FAIL
        checks.append(
            Check(
                status,
                f"{symbol} size",
                f"smallest order {asset.min_order_size:g} (about ${smallest:,.2f}); "
                f"position limit ${largest:,.2f}",
            )
        )
    return checks


def describe_error(exc: Exception) -> str:
    """Explain an error in plain words, with any key hidden."""
    import requests
    from alpaca.common.exceptions import APIError

    from strata.logging_setup import redact

    if isinstance(exc, APIError):
        code = exc.status_code
        hints = {
            401: "the keys were rejected: check you pasted your PAPER keys correctly",
            403: "the keys were rejected or lack permission: check your PAPER keys",
            429: "too many requests: wait a minute and try again",
        }
        text = f"Alpaca answered HTTP {code}: {exc}"
        if code in hints:
            text += f" ({hints[code]})"
    elif isinstance(exc, requests.exceptions.Timeout):
        text = "timed out: Alpaca didn't answer in time. Check your internet connection."
    elif isinstance(exc, requests.exceptions.ConnectionError):
        text = "couldn't reach Alpaca. Check your internet connection."
    else:
        text = f"{type(exc).__name__}: {exc}"
    return redact(text)


# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the STRATA setup. Never places orders.")
    parser.add_argument(
        "--connect",
        action="store_true",
        help="also log in to your Alpaca PAPER account and fetch recent prices (read-only)",
    )
    parser.add_argument("--config", default=str(ROOT / "config.yaml"), help=argparse.SUPPRESS)
    parser.add_argument("--env", default=str(ROOT / ".env"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    print("STRATA setup check (this never places orders)\n")
    results: list[Check] = []

    def report(*checks: Check) -> None:
        for check in checks:
            print(check.line())
            results.append(check)

    report(check_python())
    if results[-1].status == FAIL:
        return 1
    report(*check_packages())
    if any(c.status == FAIL for c in results):
        return 1  # the checks below need the packages

    config_checks, config = check_config(Path(args.config))
    report(*config_checks)
    env_checks, env = check_env(Path(args.env))
    report(*env_checks)
    report(check_env_not_in_git())

    if args.connect:
        if any(c.status == FAIL for c in results):
            report(Check(FAIL, "connection", "skipped: fix the [FAIL] lines above first"))
        else:
            print("\nConnecting to your Alpaca PAPER account (read-only)...")
            report(*check_connection(config, env))

    failures = sum(c.status == FAIL for c in results)
    warnings = sum(c.status == WARN for c in results)
    print()
    if failures:
        print(f"{failures} problem(s) found. Fix the [FAIL] lines, then run this again.")
    else:
        print("No problems found" + (f" ({warnings} warning(s) to read)." if warnings else "."))
        if not args.connect:
            print("Next: python check_setup.py --connect   (tests your paper keys)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
