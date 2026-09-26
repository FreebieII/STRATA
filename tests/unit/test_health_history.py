"""The API's own record of its health checks (strata/api/health_history.py)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

from strata.api.health_history import (
    CONFIRM_AFTER,
    HealthHistory,
    Sampler,
    describe_change,
    sample_once,
)
from strata.health import ComponentHealth

T0 = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)  # on a whole hour


def checks(database_ok: bool = True, latency: float | None = 2.0) -> list[ComponentHealth]:
    return [
        ComponentHealth(
            "database",
            database_ok,
            "reachable" if database_ok else "OperationalError: refused",
            latency if database_ok else None,
        ),
        ComponentHealth("redis", True, "reachable", 0.5),
    ]


def test_readings_are_grouped_into_time_slots():
    history = HealthHistory()
    # Four readings in the 12:01 slot, one of them failed.
    for i, ok in enumerate([True, True, False, True]):
        history.add(T0 + timedelta(minutes=1, seconds=15 * i), checks(ok, latency=1.0 + i))
    series = {s.name: s for s in history.summary("1h", T0 + timedelta(minutes=1, seconds=50))}
    database = series["database"]
    assert len(database.points) == 60  # one-minute slots
    slot = database.points[-1]
    assert slot.start == T0 + timedelta(minutes=1)
    assert (slot.samples, slot.failed) == (4, 1)
    assert slot.latency_avg_ms == round((1.0 + 2.0 + 4.0) / 3, 2)  # failed readings have none
    assert slot.latency_max_ms == 4.0
    assert database.points[-2].samples == 0
    assert database.availability_pct == 75.0
    assert series["redis"].availability_pct == 100.0


def test_slots_start_on_round_times():
    history = HealthHistory()
    history.add(T0 + timedelta(minutes=7), checks())
    for window, size in (("1h", 60), ("6h", 300), ("24h", 1200)):
        points = history.summary(window, T0 + timedelta(minutes=7, seconds=3))[0].points
        assert all(p.start.timestamp() % size == 0 for p in points)
        assert sum(p.samples for p in points) == 1


def test_old_readings_are_forgotten():
    history = HealthHistory(keep=timedelta(hours=24))
    history.add(T0, checks())
    history.add(T0 + timedelta(hours=25), checks())
    later = history.summary("24h", T0 + timedelta(hours=25))
    assert sum(p.samples for p in later[0].points) == 1
    assert history.recording_since == T0


def test_no_readings_means_no_series():
    assert HealthHistory().summary("1h", T0) == []


def test_a_check_failing_from_the_start_is_reported_at_once():
    changes = HealthHistory().add(T0, checks(database_ok=False))
    assert [(c.name, c.ok) for c in changes] == [("database", False)]


def test_one_bad_reading_is_not_reported_but_two_are():
    history = HealthHistory()
    assert history.add(T0, checks()) == []
    assert history.add(T0 + timedelta(seconds=15), checks(False)) == []  # a blip
    assert history.add(T0 + timedelta(seconds=30), checks()) == []
    assert CONFIRM_AFTER == 2
    assert history.add(T0 + timedelta(seconds=45), checks(False)) == []
    failed = history.add(T0 + timedelta(seconds=60), checks(False))
    assert [(c.name, c.ok) for c in failed] == [("database", False)]
    history.add(T0 + timedelta(minutes=5), checks())
    recovered = history.add(T0 + timedelta(minutes=5, seconds=15), checks())
    assert [(c.name, c.ok) for c in recovered] == [("database", True)]
    assert recovered[0].after == timedelta(minutes=4, seconds=15)


def test_changes_become_readable_events():
    history = HealthHistory()
    down = history.add(T0, checks(False))[0]
    assert describe_change(down) == (
        "health_failed",
        "error",
        "database check is failing: OperationalError: refused",
    )
    history.add(T0 + timedelta(minutes=3), checks())
    up = history.add(T0 + timedelta(minutes=3, seconds=15), checks())[0]
    assert describe_change(up) == (
        "health_recovered",
        "info",
        "database check is working again after 3 min",
    )


def test_sample_once_stores_an_event_for_each_change():
    stored = []
    history = HealthHistory()

    def record(event_type, message, **kwargs):
        stored.append((event_type, kwargs["severity"], kwargs["details"]["check"]))

    sample_once(history, lambda: checks(False), record, now=lambda: T0)
    sample_once(history, lambda: checks(False), record, now=lambda: T0 + timedelta(seconds=15))
    assert stored == [("health_failed", "error", "database")]


def test_the_sampler_reads_until_stopped():
    history = HealthHistory()
    sampler = Sampler(history, lambda: checks(), lambda *a, **k: None, every_s=0.01)
    sampler.start()
    deadline = time.monotonic() + 5
    while history.recording_since is None and time.monotonic() < deadline:
        time.sleep(0.01)
    sampler.stop()
    taken = sum(p.samples for p in history.summary("1h", datetime.now(UTC))[0].points)
    assert taken >= 1
    time.sleep(0.05)
    assert sum(p.samples for p in history.summary("1h", datetime.now(UTC))[0].points) == taken


def test_a_failing_reading_does_not_stop_the_sampler():
    history = HealthHistory()
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")
        return checks()

    sampler = Sampler(history, flaky, lambda *a, **k: None, every_s=0.01)
    sampler.start()
    deadline = time.monotonic() + 5
    while history.recording_since is None and time.monotonic() < deadline:
        time.sleep(0.01)
    sampler.stop()
    assert len(calls) >= 2
    assert history.recording_since is not None
