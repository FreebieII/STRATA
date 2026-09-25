"""Read Alpaca API keys from the .env file, without ever showing them.

Keys live only in .env, which git ignores. This module reads that file,
checks that the keys the bot needs are filled in, and hides them
whenever they're printed. Paper and live keys have different names, so
paper mode can never pick up your real-money keys by accident.

Everything comes from the .env file itself, not from environment
variables. That way LIVE_TRADING can only be switched on in .env, as the
rules require, and a leftover variable in your terminal can't change
which keys the bot uses.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from dotenv.parser import parse_stream

from . import PROJECT_ROOT

DEFAULT_ENV_PATH = PROJECT_ROOT / ".env"

PAPER_KEY_NAMES = ("ALPACA_PAPER_API_KEY", "ALPACA_PAPER_SECRET_KEY")
LIVE_KEY_NAMES = ("ALPACA_LIVE_API_KEY", "ALPACA_LIVE_SECRET_KEY")
SECRET_NAMES = PAPER_KEY_NAMES + LIVE_KEY_NAMES
LIVE_SWITCH_NAME = "LIVE_TRADING"

Account = Literal["paper", "live"]


class CredentialsError(Exception):
    """.env is missing or malformed, or a key the bot needs is empty."""


@dataclass(frozen=True, repr=False)
class AlpacaKeys:
    """One Alpaca key pair. Printing it shows <hidden>, never the keys."""

    account: Account
    api_key: str
    secret_key: str

    @property
    def is_paper(self) -> bool:
        return self.account == "paper"

    def __repr__(self) -> str:
        return f"AlpacaKeys(account={self.account!r}, api_key=<hidden>, secret_key=<hidden>)"


def read_env_file(path: str | Path = DEFAULT_ENV_PATH) -> dict[str, str]:
    """Return the NAME=value pairs in .env as a dict.

    Environment variables are NOT consulted and nothing is copied into
    them. Malformed lines and repeated names are refused.
    """
    path = Path(path)
    if not path.is_file():
        raise CredentialsError(
            f"No {path} file found. Create it from the template:\n"
            "    macOS/Linux:  cp .env.example .env\n"
            "    Windows:      copy .env.example .env\n"
            "then paste your Alpaca paper keys into it."
        )
    values: dict[str, str] = {}
    counts: Counter[str] = Counter()
    bad_lines: list[int] = []
    try:
        # utf-8-sig also accepts files that Windows Notepad saved with a BOM.
        with path.open(encoding="utf-8-sig") as fh:
            for binding in parse_stream(fh):
                if binding.error:
                    bad_lines.append(binding.original.line)
                elif binding.key is not None:
                    counts[binding.key] += 1
                    values[binding.key] = (binding.value or "").strip()
    except UnicodeDecodeError:
        raise CredentialsError(f"{path} must be saved as plain UTF-8 text.") from None

    # Report line numbers and names only. Never echo a line: it may hold a key.
    problems = []
    if bad_lines:
        problems.append("line(s) " + ", ".join(map(str, bad_lines)) + " are not in NAME=value form")
    repeated = sorted(name for name, n in counts.items() if n > 1)
    if repeated:
        problems.append("these names appear more than once: " + ", ".join(repeated))
    if problems:
        raise CredentialsError(f"{path} has problems: " + "; ".join(problems) + ".")
    return values


def load_paper_keys(env: Mapping[str, str]) -> AlpacaKeys:
    """The paper-trading (fake money) keys. Used by backtest and paper mode."""
    return _load_keys(env, "paper")


def load_live_keys(env: Mapping[str, str]) -> AlpacaKeys:
    """The live (real money) keys.

    Only modes.unlock_live_mode() should call this, after the --live flag
    and LIVE_TRADING=true have both been checked.
    """
    return _load_keys(env, "live")


def _load_keys(env: Mapping[str, str], account: Account) -> AlpacaKeys:
    key_name, secret_name = PAPER_KEY_NAMES if account == "paper" else LIVE_KEY_NAMES
    missing = [name for name in (key_name, secret_name) if not env.get(name, "").strip()]
    if missing:
        verb = "is" if len(missing) == 1 else "are"
        raise CredentialsError(
            f"{' and '.join(missing)} {verb} empty or missing in .env. "
            f"Paste your Alpaca {account} keys into .env (see .env.example)."
        )
    return AlpacaKeys(
        account=account,
        api_key=env[key_name].strip(),
        secret_key=env[secret_name].strip(),
    )


def live_trading_switch_on(env: Mapping[str, str]) -> bool:
    """True only if .env says LIVE_TRADING=true (capital letters don't matter).

    Anything else, including "1", "yes" or a missing line, counts as off.
    """
    return env.get(LIVE_SWITCH_NAME, "").strip().lower() == "true"


def secret_values(env: Mapping[str, str]) -> list[str]:
    """Every key value present in .env, so the logger can hide them all."""
    return [env[name] for name in SECRET_NAMES if env.get(name)]


def looks_like_paper_key(api_key: str) -> bool:
    """Alpaca paper key IDs normally start with "PK" (live ones with "AK")."""
    return api_key.strip().upper().startswith("PK")
