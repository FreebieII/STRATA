"""Logging: every decision the bot makes, and the reason for it, goes to a file.

Three files are written in the logs folder:

    strata.log      everything, as readable text: messages, warnings, errors
    decisions.log   only decisions (BUY, SELL, SKIP, REJECT, HALT, ...) and why
    events.jsonl    everything again, one JSON object per line, for machines

Every JSON event has the same fields, so events can be searched and joined:
timestamp, level, logger, message, component, event_type, request_id,
symbol, strategy, agent, decision, result, error, and details (anything
else). Fields that don't apply are null.

Every registered secret is replaced by *** before anything is written, so a
key can't leak into a log or onto the screen, even inside an error message.
"""

from __future__ import annotations

import json
import logging
import traceback
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

DECISIONS_LOGGER = "strata.decisions"
EVENTS_LOGGER = "strata.events"
MAIN_LOG_NAME = "strata.log"
DECISIONS_LOG_NAME = "decisions.log"
EVENTS_LOG_NAME = "events.jsonl"

# The fields every JSON event carries (besides timestamp, level, logger and message).
EVENT_FIELDS = (
    "component",
    "event_type",
    "request_id",
    "symbol",
    "strategy",
    "agent",
    "decision",
    "result",
    "error",
)

_MAX_BYTES = 5_000_000  # start a fresh file after about 5 MB...
_BACKUPS = 20  # ...and keep the 20 newest old files

_secrets: set[str] = set()
_installed: list[tuple[logging.Logger, logging.Handler]] = []
_component = "cli"
# Fields attached to every event inside a `log_context` block (e.g. request_id).
_context: ContextVar[dict[str, str]] = ContextVar("strata_log_context")


def register_secrets(*values: str | None) -> None:
    """Hide these strings (keys, passwords, tokens) in all log output from now on."""
    for value in values:
        if value and len(value.strip()) >= 4:
            _secrets.add(value.strip())


def redact(text: str) -> str:
    """Replace every registered secret in `text` with ***."""
    for secret in sorted(_secrets, key=len, reverse=True):
        text = text.replace(secret, "***")
    return text


@contextmanager
def log_context(**fields: str) -> Iterator[None]:
    """Attach fields (such as request_id) to every log event inside the block."""
    token = _context.set({**_context.get({}), **fields})
    try:
        yield
    finally:
        _context.reset(token)


def log_event(
    event_type: str,
    message: str,
    *,
    level: int = logging.INFO,
    logger: str = EVENTS_LOGGER,
    **fields: object,
) -> None:
    """Record a structured event.

    Fields named in EVENT_FIELDS become top-level JSON fields; anything else
    goes under "details". Example:
        log_event("http_request", "GET /health -> 200", result=200, duration_ms=3.1)
    """
    logging.getLogger(logger).log(
        level, message, extra={"strata": {"event_type": event_type, **fields}}
    )


def log_decision(action: str, reason: str, *, level: int = logging.INFO, **details: object) -> None:
    """Record one decision and why it was made. A reason is required.

    Example:
        log_decision("REJECT", "order is larger than MAX_POSITION_PCT allows",
                     symbol="SPY", side="buy", value="70.00")
    writes this line to decisions.log (and strata.log):
        DECISION REJECT | symbol=SPY side=buy value=70.00 | reason: order is larger ...
    and a JSON event with event_type "decision" and decision "REJECT" to events.jsonl.
    """
    if not reason or not reason.strip():
        raise ValueError("every decision needs a reason")
    action = action.upper()
    parts = [f"DECISION {action}"]
    if details:
        parts.append(" ".join(f"{key}={value}" for key, value in details.items()))
    parts.append(f"reason: {reason}")
    fields = {"event_type": "decision", "decision": action, "reason": reason, **details}
    logging.getLogger(DECISIONS_LOGGER).log(level, " | ".join(parts), extra={"strata": fields})


def event_dict(record: logging.LogRecord) -> dict[str, Any]:
    """The JSON event for a log record, with every secret already hidden."""
    fields: dict[str, Any] = {"component": _component, "event_type": "log"}
    fields.update(_context.get({}))
    fields.update(getattr(record, "strata", None) or {})

    event: dict[str, Any] = {
        "timestamp": datetime.fromtimestamp(record.created, tz=UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "level": record.levelname,
        "logger": record.name,
        "message": record.getMessage(),
    }
    for name in EVENT_FIELDS:
        event[name] = fields.pop(name, None)
    details = {key: value for key, value in fields.items() if value is not None}
    if record.exc_info and record.exc_info[1] is not None:
        error = record.exc_info[1]
        event["error"] = event["error"] or f"{type(error).__name__}: {error}"
        details["traceback"] = "".join(traceback.format_exception(*record.exc_info))
    event["details"] = details
    return {key: _redact_all(value) for key, value in event.items()}


def _redact_all(value: Any) -> Any:
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {key: _redact_all(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_redact_all(item) for item in value]
    if isinstance(value, bool | int | float) or value is None:
        return value
    return redact(str(value))


class JsonFormatter(logging.Formatter):
    """One JSON object per line; see event_dict for the fields."""

    def format(self, record: logging.LogRecord) -> str:
        # A second redaction pass over the final text, in case a secret
        # only appears once the event has been serialised.
        return redact(json.dumps(event_dict(record), ensure_ascii=False, default=str))


class _TextFormatter(logging.Formatter):
    """Formats a readable line (including any traceback), then hides secrets in it."""

    def __init__(self, fmt: str, tz: ZoneInfo | None) -> None:
        super().__init__(fmt)
        self._tz = tz

    def formatTime(self, record: logging.LogRecord, datefmt: str | None = None) -> str:  # noqa: N802
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
    *,
    component: str = "cli",
    console_format: Literal["text", "json"] = "text",
) -> None:
    """Send log messages to the screen and to the files in `logs_dir`.

    Text timestamps use `tz` (New York time in config.yaml) so they line up
    with US market hours; JSON timestamps are UTC. `component` names this
    process in every JSON event. Safe to call more than once: the previous
    setup is replaced.
    """
    global _component
    logs_dir = Path(logs_dir)
    logs_dir.mkdir(parents=True, exist_ok=True)
    shutdown_logging()
    _component = component

    root = logging.getLogger()
    root.setLevel(level)
    text_format = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"

    main_file = _rotating(logs_dir / MAIN_LOG_NAME)
    main_file.setFormatter(_TextFormatter(text_format, tz))
    _install(root, main_file)

    events_file = _rotating(logs_dir / EVENTS_LOG_NAME)
    events_file.setFormatter(JsonFormatter())
    _install(root, events_file)

    # Decisions are always recorded, whatever `level` says.
    decisions = logging.getLogger(DECISIONS_LOGGER)
    decisions.setLevel(logging.INFO)
    decisions_file = _rotating(logs_dir / DECISIONS_LOG_NAME)
    decisions_file.setFormatter(_TextFormatter("%(asctime)s | %(message)s", tz))
    _install(decisions, decisions_file)

    if console:
        screen = logging.StreamHandler()
        if console_format == "json":
            screen.setFormatter(JsonFormatter())
        else:
            screen.setFormatter(_TextFormatter("%(asctime)s %(levelname)s %(message)s", tz))
        _install(root, screen)

    # Libraries that are chatty at INFO level. The HTTP clients (httpx and
    # friends) log every full URL, query string included, which is where some
    # APIs expect keys, so they only get to report warnings. Alembic announces
    # itself every time the health check reads the schema version.
    noisy_loggers = (
        "urllib3",
        "httpx",
        "httpcore",
        "httpx2",
        "httpcore2",
        "websockets",
        "asyncio",
        "alembic.runtime.migration",
    )
    for noisy in noisy_loggers:
        logging.getLogger(noisy).setLevel(logging.WARNING)


def shutdown_logging() -> None:
    """Flush and close the handlers that setup_logging() installed."""
    while _installed:
        logger, handler = _installed.pop()
        logger.removeHandler(handler)
        handler.close()


def _rotating(path: Path) -> RotatingFileHandler:
    return RotatingFileHandler(path, maxBytes=_MAX_BYTES, backupCount=_BACKUPS, encoding="utf-8")


def _install(logger: logging.Logger, handler: logging.Handler) -> None:
    logger.addHandler(handler)
    _installed.append((logger, handler))
