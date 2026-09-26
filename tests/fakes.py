"""In-memory stand-ins for services, for fast unit tests.

FakeRedis implements only the handful of Redis commands STRATA uses, with a
clock the test can move forward to make keys expire.
"""

from __future__ import annotations

from typing import Any

from redis.exceptions import ConnectionError as RedisConnectionError


class FakeRedis:
    def __init__(self) -> None:
        self.now = 0.0
        self.data: dict[str, Any] = {}
        self.expires: dict[str, float] = {}
        self.down = False

    # --- helpers for tests
    def advance(self, seconds: float) -> None:
        self.now += seconds

    def _check(self) -> None:
        if self.down:
            raise RedisConnectionError("Error 111 connecting to redis:6379. Connection refused.")

    def _alive(self, key: str) -> bool:
        expiry = self.expires.get(key)
        if expiry is not None and expiry <= self.now:
            self.data.pop(key, None)
            self.expires.pop(key, None)
        return key in self.data

    # --- commands
    def get(self, key: str) -> Any:
        self._check()
        return self.data[key] if self._alive(key) else None

    def set(self, key: str, value: Any, ex: int | None = None) -> bool:
        self._check()
        self.data[key] = str(value)
        if ex is None:
            self.expires.pop(key, None)
        else:
            self.expires[key] = self.now + ex
        return True

    def delete(self, *keys: str) -> int:
        self._check()
        removed = 0
        for key in keys:
            if self._alive(key):
                removed += 1
            self.data.pop(key, None)
            self.expires.pop(key, None)
        return removed

    def incr(self, key: str) -> int:
        self._check()
        value = int(self.data[key]) + 1 if self._alive(key) else 1
        self.data[key] = str(value)
        return value

    def expire(self, key: str, seconds: int, nx: bool = False) -> bool:
        self._check()
        if not self._alive(key):
            return False
        if nx and key in self.expires:
            return False
        self.expires[key] = self.now + seconds
        return True

    def ttl(self, key: str) -> int:
        self._check()
        if not self._alive(key):
            return -2
        if key not in self.expires:
            return -1
        return max(int(self.expires[key] - self.now), 0)

    def sadd(self, key: str, *members: str) -> int:
        self._check()
        current = self.data.setdefault(key, set()) if self._alive(key) else set()
        self.data[key] = current
        before = len(current)
        current.update(members)
        return len(current) - before

    def srem(self, key: str, *members: str) -> int:
        self._check()
        if not self._alive(key):
            return 0
        before = len(self.data[key])
        self.data[key].difference_update(members)
        return before - len(self.data[key])

    def smembers(self, key: str) -> set[str]:
        self._check()
        return set(self.data[key]) if self._alive(key) else set()

    def ping(self) -> bool:
        self._check()
        return True

    def pipeline(self) -> _Pipeline:
        return _Pipeline(self)

    def close(self) -> None:
        pass


class _Pipeline:
    def __init__(self, redis: FakeRedis) -> None:
        self._redis = redis
        self._calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str):
        def queue(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self

        return queue

    def execute(self) -> list[Any]:
        return [getattr(self._redis, name)(*args, **kwargs) for name, args, kwargs in self._calls]


class FakeStore:
    """Stands in for strata.api.store.DatabaseStore, in memory."""

    def __init__(self) -> None:
        from datetime import UTC, datetime

        self._now = lambda: datetime.now(UTC)
        self.events: list[Any] = []
        self.audit: list[Any] = []
        self.operators: dict[str, dict[str, Any]] = {}
        self.down = False

    def _check(self) -> None:
        if self.down:
            from sqlalchemy.exc import OperationalError

            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    def add_operator(self, username: str, password: str) -> None:
        self.operators[username] = {
            "password": password,
            "disabled": False,
            "valid_since": self._now().replace(year=2000),
        }

    def record_event(
        self, event_type, message, *, severity="info", details=None, request_id=None, at=None
    ):
        from strata.api.schemas import SystemEventOut

        self.events.append(
            SystemEventOut(
                id=len(self.events) + 1,
                occurred_at=at or self._now(),
                component="api",
                event_type=event_type,
                severity=severity,
                message=message,
                request_id=request_id,
                details=dict(details or {}),
            )
        )

    def record_audit(
        self,
        *,
        actor,
        action,
        target_type=None,
        target_id=None,
        details=None,
        request_id=None,
        at=None,
    ):
        from strata.api.schemas import AuditEntryOut

        self._check()
        self.audit.append(
            AuditEntryOut(
                id=len(self.audit) + 1,
                occurred_at=at or self._now(),
                actor=actor,
                action=action,
                target_type=target_type,
                target_id=target_id,
                request_id=request_id,
                details=dict(details or {}),
            )
        )

    def authenticate(self, username: str, password: str) -> str | None:
        self._check()
        operator = self.operators.get(username.strip().lower())
        if operator is None or operator["disabled"] or operator["password"] != password:
            return None
        return username.strip().lower()

    def operator_valid_since(self, username: str):
        self._check()
        operator = self.operators.get(username)
        if operator is None or operator["disabled"]:
            return None
        return operator["valid_since"]

    def recent_events(self, *, limit, before_id=None, severity=None, event_type=None, since=None):
        self._check()
        rows = [
            event
            for event in reversed(self.events)
            if (before_id is None or event.id < before_id)
            and (severity is None or event.severity == severity)
            and (event_type is None or event.event_type == event_type)
            and (since is None or event.occurred_at >= since)
        ]
        return rows[:limit]

    def recent_audit(self, *, limit, before_id=None, action=None, since=None):
        self._check()
        rows = [
            entry
            for entry in reversed(self.audit)
            if (before_id is None or entry.id < before_id)
            and (action is None or entry.action == action)
            and (since is None or entry.occurred_at >= since)
        ]
        return rows[:limit]

    # The same answers the database gives, worked out in Python.
    def event_stats(self, *, days, tz, event_type=None):
        from collections import Counter

        from strata.api import stats

        self._check()
        since, day_list = stats.period(days, tz, self._now())
        rows = [
            e
            for e in self.events
            if e.occurred_at >= since and (event_type is None or e.event_type == event_type)
        ]
        counts = Counter((stats.local_day(e.occurred_at, tz), e.severity) for e in rows)
        types = Counter(e.event_type for e in rows)
        return stats.event_stats(
            days=days,
            tz=tz,
            since=since,
            day_list=day_list,
            counts=[(day, severity, n) for (day, severity), n in counts.items()],
            types=sorted(types.items(), key=lambda item: (-item[1], item[0])),
        )

    def audit_stats(self, *, days, tz, action=None):
        from collections import Counter

        from strata.api import stats

        self._check()
        since, day_list = stats.period(days, tz, self._now())
        counts = Counter(
            (stats.local_day(a.occurred_at, tz), a.action)
            for a in self.audit
            if a.occurred_at >= since and (action is None or a.action == action)
        )
        return stats.audit_stats(
            days=days,
            tz=tz,
            since=since,
            day_list=day_list,
            counts=[(day, name, n) for (day, name), n in counts.items()],
        )
