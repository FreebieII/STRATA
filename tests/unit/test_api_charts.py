"""The API's chart data: event and audit statistics, health history, trading setup."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pytest

from strata.health import ComponentHealth
from tests.helpers import FAKE_API_TOKEN

AUTH = {"Authorization": f"Bearer {FAKE_API_TOKEN}"}


def test_status_describes_the_whole_trading_setup(client):
    trading = client().get("/system/status", headers=AUTH).json()["trading"]
    assert trading["timezone"] == "America/New_York"
    assert trading["strategies"] == {
        "ma_crossover": {"fast_period": 20, "slow_period": 50},
        "rsi_reversion": {"rsi_period": 14, "buy_below": 30.0, "sell_above": 70.0},
    }
    assert trading["costs"]["crypto"]["fee_pct"] == 0.25
    assert trading["costs"]["stock"]["fee_per_sell_usd"] == 0.02
    assert trading["backtest"]["start_date"] == "2021-01-01"
    assert trading["backtest"]["test_start_date"] == "2024-07-01"
    assert trading["stock_data_feed"] == "sip"


@pytest.mark.parametrize(
    "path",
    ["/system/events/stats", "/audit/stats", "/system/health/history"],
)
def test_chart_data_needs_a_login(client, path):
    assert client().get(path).status_code == 401


def test_events_are_counted_per_day_by_severity(client, stand_in):
    now = datetime.now(UTC)
    store = stand_in.store
    store.record_event("api_started", "a", at=now)
    store.record_event("login_failed", "b", severity="warning", at=now)
    store.record_event("login_failed", "c", severity="warning", at=now - timedelta(days=1))
    store.record_event("api_started", "old", at=now - timedelta(days=30))
    body = client().get("/system/events/stats?days=7&tz=UTC", headers=AUTH).json()
    assert body["days"] == 7
    assert len(body["buckets"]) == 7
    today, yesterday = body["buckets"][-1], body["buckets"][-2]
    assert today["day"] == now.date().isoformat()
    assert (today["info"], today["warning"]) == (1, 1)
    assert yesterday["warning"] == 1
    assert body["total"] == 3  # the 30-day-old one is outside the period
    assert body["types"] == [
        {"name": "login_failed", "count": 2},
        {"name": "api_started", "count": 1},
    ]


def test_days_are_counted_in_the_viewers_time_zone(client, stand_in):
    # 23:30 UTC is already the next day in Windhoek (UTC+2).
    now = datetime.now(UTC)
    late = now.replace(hour=23, minute=30, second=0, microsecond=0) - timedelta(days=1)
    stand_in.store.record_event("api_started", "late", at=late)
    utc = client().get("/system/events/stats?days=3&tz=UTC", headers=AUTH).json()
    windhoek = client().get("/system/events/stats?days=3&tz=Africa/Windhoek", headers=AUTH).json()

    def day_of(body):
        return [b["day"] for b in body["buckets"] if b["info"]]

    assert day_of(utc) == [late.date().isoformat()]
    assert day_of(windhoek) == [(late.date() + timedelta(days=1)).isoformat()]


def test_event_stats_can_be_limited_to_one_type(client, stand_in):
    stand_in.store.record_event("api_started", "a")
    stand_in.store.record_event("login_failed", "b", severity="warning")
    body = client().get("/system/events/stats?event_type=login_failed", headers=AUTH).json()
    assert body["total"] == 1
    assert body["buckets"][-1]["warning"] == 1


@pytest.mark.parametrize(
    "query",
    ["days=0", "days=91", "tz=Mars/Olympus", "tz=../../etc/passwd", "event_type=Bad Name"],
)
def test_event_stats_refuse_bad_questions(client, query):
    assert client().get(f"/system/events/stats?{query}", headers=AUTH).status_code == 422


def test_audit_entries_are_counted_per_day_by_action(client, stand_in):
    now = datetime.now(UTC)
    store = stand_in.store
    store.record_audit(actor="alex", action="login", at=now)
    store.record_audit(actor="alex", action="login", at=now)
    store.record_audit(actor="alex", action="logout", at=now)
    store.record_audit(actor="cli:root", action="operator_created", at=now - timedelta(days=2))
    body = client().get("/audit/stats?days=7&tz=UTC", headers=AUTH).json()
    assert body["buckets"][-1]["counts"] == {"login": 2, "logout": 1}
    assert body["buckets"][-1]["total"] == 3
    assert body["buckets"][-3]["counts"] == {"operator_created": 1}
    assert body["actions"][0] == {"name": "login", "count": 2}
    assert body["total"] == 4
    only_logins = client().get("/audit/stats?action=login", headers=AUTH).json()
    assert only_logins["total"] == 2


def test_lists_can_start_from_a_time(client, stand_in):
    now = datetime.now(UTC)
    stand_in.store.record_event("api_started", "old", at=now - timedelta(days=10))
    stand_in.store.record_event("api_started", "new", at=now)
    stand_in.store.record_audit(actor="alex", action="login", at=now - timedelta(days=10))
    stand_in.store.record_audit(actor="alex", action="logout", at=now)
    since = (now - timedelta(days=1)).isoformat()
    events = client().get("/system/events", params={"since": since}, headers=AUTH).json()
    audit = client().get("/audit", params={"since": since}, headers=AUTH).json()
    assert [e["message"] for e in events["items"]] == ["new"]
    assert [a["action"] for a in audit["items"]] == ["logout"]


def test_health_history_reports_the_recorded_readings(client, stand_in):
    services = stand_in.services()
    now = datetime.now(UTC)
    services.health_history.add(now, [ComponentHealth("database", True, "reachable", 1.5)])
    from fastapi.testclient import TestClient

    from strata.api.app import create_app

    app_client = TestClient(create_app(services), base_url="https://testserver")
    body = app_client.get("/system/health/history?window=1h", headers=AUTH).json()
    assert body["window"] == "1h"
    assert body["bucket_s"] == 60
    assert body["sample_every_s"] == 15
    assert body["recording_since"] is not None
    [database] = body["series"]
    assert database["name"] == "database"
    assert len(database["points"]) == 60
    assert database["points"][-1]["latency_avg_ms"] == 1.5
    assert database["availability_pct"] == 100.0


def test_health_history_refuses_unknown_windows(client):
    assert client().get("/system/health/history?window=7d", headers=AUTH).status_code == 422


def test_the_api_takes_its_own_readings_while_it_runs(stand_in):
    from fastapi.testclient import TestClient

    from strata.api.app import create_app

    services = stand_in.services(sample_health_every_s=0.02)
    stand_in.redis_ok = False  # redis fails from the start: an event is stored
    with TestClient(create_app(services), base_url="https://testserver"):
        deadline = time.monotonic() + 5
        while services.health_history.recording_since is None and time.monotonic() < deadline:
            time.sleep(0.01)
    assert services.health_history.recording_since is not None
    failed = [e for e in stand_in.store.events if e.event_type == "health_failed"]
    assert failed and failed[0].details["check"] == "redis"

    # Stopping the API stops the readings too.
    def taken() -> int:
        points = services.health_history.summary("1h", datetime.now(UTC))[0].points
        return sum(p.samples for p in points)

    before = taken()
    time.sleep(0.2)
    assert taken() == before
