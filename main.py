"""STRATA: start the bot.

    python main.py                       paper trading (the default)
    python main.py --mode paper          the same, spelled out
    python main.py --mode backtest       test the strategies on past prices
    python main.py --mode live --live    REAL money: finish the README checklist first

STAGE 1 OF 4: this file already picks the mode and guards live mode, but
the backtester (stage 2) and the trading loop (stage 4) aren't built yet,
so every mode stops after its start-up checks. No orders are ever sent.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from strata.config import DEFAULT_CONFIG_PATH, ConfigError, load_config
from strata.credentials import (
    DEFAULT_ENV_PATH,
    CredentialsError,
    load_paper_keys,
    read_env_file,
    secret_values,
)
from strata.logging_setup import log_decision, register_secrets, setup_logging
from strata.modes import LiveModeRefused, Mode, resolve_mode, unlock_live_mode

EXIT_OK = 0
EXIT_REFUSED = 2

log = logging.getLogger("strata.main")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="STRATA trading bot for Alpaca. Paper trading is the default.",
    )
    parser.add_argument(
        "--mode",
        choices=[mode.value for mode in Mode],
        default=None,
        help="backtest, paper or live (default: paper)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="needed for --mode live, along with LIVE_TRADING=true in .env and a typed phrase",
    )
    parser.add_argument(
        "--config", default=str(DEFAULT_CONFIG_PATH), help="settings file (default: config.yaml)"
    )
    parser.add_argument("--env", default=str(DEFAULT_ENV_PATH), help="secrets file (default: .env)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        mode = resolve_mode(args.mode, args.live)
        config = load_config(args.config)
    except (ValueError, ConfigError) as exc:
        # The settings can't be trusted, so log next to the config file instead.
        setup_logging(Path(args.config).resolve().parent / "logs")
        log_decision("REFUSE_START", f"not started: {exc}", level=logging.ERROR)
        return EXIT_REFUSED

    setup_logging(config.paths.logs_dir, config.logging.level, tz=config.tz)
    log.info("STRATA starting in %s mode", mode.value.upper())

    try:
        env = read_env_file(args.env)
        register_secrets(*secret_values(env))
        if mode is Mode.LIVE:
            keys = unlock_live_mode(live_flag=args.live, env=env, risk=config.risk)
        else:
            keys = load_paper_keys(env)
    except (CredentialsError, LiveModeRefused) as exc:
        log_decision("REFUSE_START", str(exc), level=logging.ERROR, mode=mode.value)
        return EXIT_REFUSED
    except KeyboardInterrupt:
        log_decision("REFUSE_START", "stopped with Ctrl+C during start-up", mode=mode.value)
        return EXIT_REFUSED

    log.info("Loaded %s keys (not shown)", keys.account)

    if mode is Mode.BACKTEST:
        reason = "the backtester is built in stage 2; nothing to run yet"
    else:
        reason = "the trading loop is built in stage 4; no orders were sent"
    log_decision("STOP", reason, mode=mode.value)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
