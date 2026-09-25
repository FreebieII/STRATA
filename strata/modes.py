"""Choose the run mode (backtest, paper or live) and guard live mode.

Paper trading is the default. Live mode trades REAL money, so it only
starts when ALL of these hold, checked in this order:

    1. you passed the --live flag on the command line,
    2. your .env file says LIVE_TRADING=true,
    3. your live API keys are filled in in .env,
    4. you type the confirmation phrase by hand, in a terminal.

If anything is missing, the bot refuses to start and says what is
missing. unlock_live_mode() is the only code that hands out live keys.
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Mapping
from enum import StrEnum

from .config import RiskLimits
from .credentials import AlpacaKeys, CredentialsError, live_trading_switch_on, load_live_keys


class Mode(StrEnum):
    BACKTEST = "backtest"
    PAPER = "paper"
    LIVE = "live"


DEFAULT_MODE = Mode.PAPER

LIVE_CONFIRMATION_PHRASE = "I ACCEPT THE RISK OF LOSING REAL MONEY"


class LiveModeRefused(Exception):
    """Live mode was asked for, but at least one safety check failed."""


def resolve_mode(mode: str | None, live_flag: bool) -> Mode:
    """Turn the --mode and --live options into a Mode. No --mode means paper."""
    chosen = Mode(mode) if mode else DEFAULT_MODE
    if live_flag and chosen is not Mode.LIVE:
        raise ValueError("--live only works together with --mode live.")
    return chosen


def unlock_live_mode(
    *,
    live_flag: bool,
    env: Mapping[str, str],
    risk: RiskLimits,
    ask: Callable[[str], str] | None = None,
    interactive: bool | None = None,
    say: Callable[[str], None] = print,
) -> AlpacaKeys:
    """Run every live-mode safety check and return the live keys if all pass.

    Raises LiveModeRefused, saying exactly what is missing, otherwise.
    `ask`, `interactive` and `say` exist so the tests can stand in for a
    person at the keyboard.
    """
    missing = []
    if not live_flag:
        missing.append("the --live flag on the command line")
    if not live_trading_switch_on(env):
        missing.append("LIVE_TRADING=true in your .env file")
    if missing:
        raise LiveModeRefused(
            "Live mode refused. Missing: " + " and ".join(missing) + ". Nothing was sent to Alpaca."
        )

    try:
        keys = load_live_keys(env)
    except CredentialsError as exc:
        raise LiveModeRefused(f"Live mode refused: {exc}") from None

    if interactive is None:
        interactive = sys.stdin is not None and sys.stdin.isatty()
    if not interactive:
        raise LiveModeRefused(
            "Live mode refused: the confirmation phrase must be typed by a person in a "
            "terminal, not piped in from a file or a script."
        )

    say(_live_warning(risk))
    ask = ask or input
    try:
        typed = ask(
            f"Type this phrase exactly, then press Enter:\n    {LIVE_CONFIRMATION_PHRASE}\n> "
        )
    except EOFError:
        typed = ""
    if typed.strip() != LIVE_CONFIRMATION_PHRASE:
        raise LiveModeRefused(
            "Live mode refused: the phrase did not match. Nothing was sent to Alpaca."
        )
    return keys


def _live_warning(risk: RiskLimits) -> str:
    line = "=" * 66
    return "\n".join(
        [
            line,
            "  LIVE MODE: this will trade REAL money in your Alpaca account.",
            line,
            f"  MAX_CAPITAL          ${risk.MAX_CAPITAL:,.2f}",
            f"  Largest position     ${risk.max_position_value:,.2f}"
            f" ({risk.MAX_POSITION_PCT:g}% of MAX_CAPITAL)",
            f"  STOP_LOSS_PCT        {risk.STOP_LOSS_PCT:g}%",
            f"  DAILY_LOSS_LIMIT     ${risk.DAILY_LOSS_LIMIT:,.2f}",
            f"  TOTAL_LOSS_LIMIT     ${risk.TOTAL_LOSS_LIMIT:,.2f}  (kill switch)",
            f"  MAX_TRADES_PER_DAY   {risk.MAX_TRADES_PER_DAY}",
            "",
            "  Past results do not predict future results. You can lose money.",
            line,
        ]
    )
