"""Small helpers shared by the tests."""

from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Obviously fake keys, used only by tests.
FAKE_PAPER_KEY = "PKTESTFAKEPAPERKEY0001"
FAKE_PAPER_SECRET = "fake-paper-secret-value-for-tests-only"
FAKE_LIVE_KEY = "AKTESTFAKELIVEKEY00001"
FAKE_LIVE_SECRET = "fake-live-secret-value-for-tests-only"


def env_text(*, paper: bool = True, live_keys: bool = False, live_trading: str = "false") -> str:
    """The text of a .env file for a test."""
    lines = [
        f"ALPACA_PAPER_API_KEY={FAKE_PAPER_KEY if paper else ''}",
        f"ALPACA_PAPER_SECRET_KEY={FAKE_PAPER_SECRET if paper else ''}",
        f"ALPACA_LIVE_API_KEY={FAKE_LIVE_KEY if live_keys else ''}",
        f"ALPACA_LIVE_SECRET_KEY={FAKE_LIVE_SECRET if live_keys else ''}",
        f"LIVE_TRADING={live_trading}",
    ]
    return "\n".join(lines) + "\n"
