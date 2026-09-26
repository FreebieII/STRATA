"""Counting events and audit entries per day, for the dashboard's charts.

Days are counted in a time zone the caller chooses (the dashboard sends the
browser's own), so "today" means the viewer's today. PostgreSQL does the
counting; the functions here turn its rows into complete day-by-day series,
including days on which nothing happened.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

from .schemas import AuditDay, AuditStats, EventDay, EventStats, NameCount

SEVERITIES = ("debug", "info", "warning", "error", "critical")
MAX_DAYS = 90
TOP_TYPES = 10

_TZ_NAME = re.compile(r"[A-Za-z0-9_+\-/]{1,64}")


@lru_cache(maxsize=1)
def _known_zones() -> frozenset[str]:
    return frozenset(available_timezones()) | {"UTC"}


def valid_timezone(name: str) -> bool:
    return bool(_TZ_NAME.fullmatch(name)) and name in _known_zones()


def period(days: int, tz: str, now: datetime | None = None) -> tuple[datetime, list[date]]:
    """The start of the first day and every day in the period, in `tz`."""
    zone = ZoneInfo(tz)
    today = (now or datetime.now(UTC)).astimezone(zone).date()
    first = today - timedelta(days=days - 1)
    return datetime.combine(first, time(0), tzinfo=zone), [
        first + timedelta(days=i) for i in range(days)
    ]


def local_day(value: datetime, tz: str) -> date:
    return value.astimezone(ZoneInfo(tz)).date()


def event_stats(
    *,
    days: int,
    tz: str,
    since: datetime,
    day_list: list[date],
    counts: Iterable[tuple[date, str, int]],
    types: Iterable[tuple[str, int]],
) -> EventStats:
    """counts: (day, severity, n) rows; types: (event_type, n), most frequent first."""
    per_day: dict[date, dict[str, int]] = {day: {} for day in day_list}
    total = 0
    for day, severity, n in counts:
        if day in per_day and severity in SEVERITIES:
            per_day[day][severity] = per_day[day].get(severity, 0) + n
            total += n
    return EventStats(
        days=days,
        tz=tz,
        since=since,
        buckets=[EventDay(day=day, **per_day[day]) for day in day_list],
        types=[NameCount(name=name, count=n) for name, n in types][:TOP_TYPES],
        total=total,
    )


def audit_stats(
    *,
    days: int,
    tz: str,
    since: datetime,
    day_list: list[date],
    counts: Iterable[tuple[date, str, int]],
) -> AuditStats:
    """counts: (day, action, n) rows."""
    per_day: dict[date, dict[str, int]] = {day: {} for day in day_list}
    totals: dict[str, int] = {}
    for day, action, n in counts:
        if day in per_day:
            per_day[day][action] = per_day[day].get(action, 0) + n
            totals[action] = totals.get(action, 0) + n
    ranked = sorted(totals.items(), key=lambda item: (-item[1], item[0]))
    return AuditStats(
        days=days,
        tz=tz,
        since=since,
        buckets=[
            AuditDay(day=day, counts=per_day[day], total=sum(per_day[day].values()))
            for day in day_list
        ],
        actions=[NameCount(name=name, count=n) for name, n in ranked],
        total=sum(totals.values()),
    )
