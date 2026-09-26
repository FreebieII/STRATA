"""Event and audit statistics, counted by PostgreSQL itself."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from strata.api.store import DatabaseStore
from strata.db.models import AuditLog, SystemEvent
from strata.db.session import session_factory


def _name() -> str:
    # The test database is shared, and audit rows can't be deleted, so every
    # test counts rows with a name of its own.
    return f"probe_{uuid.uuid4().hex[:12]}"


def test_events_are_counted_per_day_in_the_asked_time_zone(engine):
    sessions = session_factory(engine)
    store = DatabaseStore(sessions, "test")
    kind = _name()
    now = datetime.now(UTC)
    # 23:30 UTC yesterday: still yesterday in UTC, already today in Windhoek (UTC+2).
    late = (now - timedelta(days=1)).replace(hour=23, minute=30, second=0, microsecond=0)
    with sessions.begin() as session:
        session.add_all(
            [
                SystemEvent(
                    occurred_at=late,
                    component="test",
                    event_type=kind,
                    severity="warning",
                    message="late",
                    details={},
                ),
                SystemEvent(
                    occurred_at=late - timedelta(minutes=5),
                    component="test",
                    event_type=kind,
                    severity="error",
                    message="also late",
                    details={},
                ),
                SystemEvent(
                    occurred_at=now - timedelta(days=40),
                    component="test",
                    event_type=kind,
                    severity="info",
                    message="too old",
                    details={},
                ),
            ]
        )

    utc = store.event_stats(days=3, tz="UTC", event_type=kind)
    windhoek = store.event_stats(days=3, tz="Africa/Windhoek", event_type=kind)

    def counted(stats):
        return {b.day: (b.warning, b.error) for b in stats.buckets if b.warning or b.error}

    assert counted(utc) == {late.date(): (1, 1)}
    assert counted(windhoek) == {late.date() + timedelta(days=1): (1, 1)}
    assert utc.total == 2
    assert [(t.name, t.count) for t in utc.types] == [(kind, 2)]
    assert len(utc.buckets) == 3


def test_audit_entries_are_counted_per_day_by_action(engine):
    sessions = session_factory(engine)
    store = DatabaseStore(sessions, "test")
    first, second = _name(), _name()
    now = datetime.now(UTC)
    with sessions.begin() as session:
        session.add_all(
            [
                AuditLog(occurred_at=now, actor="t", action=first, details={}),
                AuditLog(occurred_at=now, actor="t", action=first, details={}),
                AuditLog(occurred_at=now - timedelta(days=1), actor="t", action=second, details={}),
            ]
        )
    body = store.audit_stats(days=7, tz="UTC")
    today = body.buckets[-1]
    assert today.counts.get(first) == 2
    assert body.buckets[-2].counts.get(second) == 1
    assert {a.name: a.count for a in body.actions}[first] == 2
    only = store.audit_stats(days=7, tz="UTC", action=second)
    assert only.total == 1


def test_lists_start_from_a_time_in_sql(engine):
    sessions = session_factory(engine)
    store = DatabaseStore(sessions, "test")
    kind = _name()
    now = datetime.now(UTC)
    with sessions.begin() as session:
        for days_ago in (0, 10):
            session.add(
                SystemEvent(
                    occurred_at=now - timedelta(days=days_ago),
                    component="test",
                    event_type=kind,
                    severity="info",
                    message=f"{days_ago} days ago",
                    details={},
                )
            )
    recent = store.recent_events(limit=10, event_type=kind, since=now - timedelta(days=1))
    assert [e.message for e in recent] == ["0 days ago"]
