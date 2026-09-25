"""Logging: every decision the bot makes, and the reason for it, goes to a file.

Two files are written in the logs folder:

    strata.log      everything: normal messages, warnings and errors
    decisions.log   only decisions (BUY, SELL, SKIP, REJECT, HALT, ...) and why

Screen output and both files pass through a filter that replaces every
registered API key with ***, so a key can't leak into a log or onto the
screen, even inside an error message.
"""

from __future__ import annotations

import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from zoneinfo import ZoneInfo

DECISIONS_LOGGER = "strata.decisions"
MAIN_LOG_NAME = "strata.log"
DECISIONS_LOG_NAME = "decisions.log"

_MAX_BYTES = 5_000_000  # start a fresh file after about 5 MB...
_BACKUPS = 20           # ...and keep the 20 newest old files

_secrets: set[str] = set()
_installed: list[tuple[logging.Logger, logging.Handler]] = []


def register_secrets(*values: str | None) -> None:
    """Hide these strings (API keys) in all log output from now on."""
    for value in values:
        if value and len(value.strip()) >= 4:
            _secrets.add(value.strip())


def redact(text: str) -> str:
    """Replace every registered secret in `text` with ***."""
    for secret in sorted(_secrets, key=len, reverse=True):
        text = text.replace(secret, "***")
    return text


class _RedactingFormatter(logging.Formatter):
    """Formats a log line (including any traceback), then hides secrets in it."""

    def __init__(self, fmt: str, tz: ZoneInfo | None) -> None:
        super().__init__(fmt)
        self._tz = tz

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:
        moment = datetime.fromtimestamp(record.created, tz=self._tz)
        if self._tz is None:
            moment = moment.astimezone()  # the computer's own time zone
        return moment.strftime("%Y-%m-%d %H:%M:%S %Z")

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def setup_logging(
    logs_dir: str | Path,
    level: str = "INFO",
    tz: ZoneInfo | None = None,
    console: bool = True,
) -> None:
    """Send log messages to the screen and to the files in `logs_dir`.

    Timestamps use `tz` (New York time by default in config.yaml), so they
    line up with US market hours. Safe to call more than once: the
    previous setup is replaced.
    """
    logs_dir = Path(logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    shutdown_logging()

    root = logging.getLogger()
    root.setLevel(level)
    file_format = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"

    main_file = RotatingFileHandler(
        logs_dir / MAIN_LOG_NAME, maxBytes=_MAX_BYTES, backupCount=_BACKUPS, encoding="utf-8"
    )
    main_file.setFormatter(_RedactingFormatter(file_format, tz))
    _install(root, main_file)

    # Decisions are always recorded, whatever `level` says.
    decisions = logging.getLogger(DECISIONS_LOGGER)
    decisions.setLevel(logging.INFO)
    decisions_file = RotatingFileHandler(
        logs_dir / DECISIONS_LOG_NAME, maxBytes=_MAX_BYTES, backupCount=_BACKUPS, encoding="utf-8"
    )
    decisions_file.setFormatter(_RedactingFormatter("%(asctime)s | %(message)s", tz))
    _install(decisions, decisions_file)

    if console:
        screen = logging.StreamHandler()
        screen.setFormatter(_RedactingFormatter("%(asctime)s %(levelname)s %(message)s", tz))
        _install(root, screen)

    # Libraries that are chatty at INFO level.
    for noisy in ("urllib3", "websockets", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def shutdown_logging() -> None:
    """Flush and close the handlers that setup_logging() installed."""
    while _installed:
        logger, handler = _installed.pop()
        logger.removeHandler(handler)
        handler.close()


def _install(logger: logging.Logger, handler: logging.Handler) -> None:
    logger.addHandler(handler)
    _installed.append((logger, handler))


def log_decision(action: str, reason: str, *, level: int = logging.INFO, **details: object) -> None:
    """Record one decision and why it was made. A reason is required.

    Example:
        log_decision("REJECT", "order is larger than MAX_POSITION_PCT allows",
                     symbol="SPY", side="buy", value="70.00")
    writes this line to decisions.log (and strata.log):
        DECISION REJECT | symbol=SPY side=buy value=70.00 | reason: order is larger ...
    """
    if not reason or not reason.strip():
        raise ValueError("every decision needs a reason")
    parts = [f"DECISION {action.upper()}"]
    if details:
        parts.append(" ".join(f"{key}={value}" for key, value in details.items()))
    parts.append(f"reason: {reason}")
    logging.getLogger(DECISIONS_LOGGER).log(level, " | ".join(parts))
