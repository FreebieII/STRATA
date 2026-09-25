"""Health checks: is each part of the system working?

Each check answers quickly (every call has a time limit) and never raises:
a failure comes back as ok=False with a short, secret-free explanation.
Anything that trades must treat "not ok" as "do not trade".
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any

import redis
from sqlalchemy import Engine, text

from .db.migrations import current_revision, head_revision
from .logging_setup import redact


@dataclass(frozen=True)
class ComponentHealth:
    name: str
    ok: bool
    detail: str
    latency_ms: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def check_database(engine: Engine) -> ComponentHealth:
    start = perf_counter()
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # any failure means "not healthy"
        return ComponentHealth("database", False, describe_error(exc))
    return ComponentHealth("database", True, "reachable", _ms_since(start))


def check_schema(engine: Engine) -> ComponentHealth:
    """Is the database at the newest migration this code expects?"""
    try:
        current = current_revision(engine)
        expected = head_revision()
    except Exception as exc:
        return ComponentHealth("schema", False, describe_error(exc))
    if current != expected:
        return ComponentHealth(
            "schema",
            False,
            f"database is at migration {current or 'none'}, code expects {expected}: "
            "run `strata db upgrade`",
        )
    return ComponentHealth("schema", True, f"up to date (migration {current})")


def check_redis(client: redis.Redis) -> ComponentHealth:
    start = perf_counter()
    try:
        client.ping()
    except Exception as exc:
        return ComponentHealth("redis", False, describe_error(exc))
    return ComponentHealth("redis", True, "reachable", _ms_since(start))


def all_ok(checks: Iterable[ComponentHealth]) -> bool:
    return all(check.ok for check in checks)


def describe_error(exc: BaseException) -> str:
    """A one-line description of an error, cut short and with secrets hidden."""
    first_line = (str(exc).strip().splitlines() or [""])[0]
    return redact(f"{type(exc).__name__}: {first_line}"[:300])


def _ms_since(start: float) -> float:
    return round((perf_counter() - start) * 1000, 1)
