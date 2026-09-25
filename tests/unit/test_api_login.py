"""Tests for dashboard login, sessions and the dashboard's read endpoints,
with stand-in services (no database or Redis needed)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from strata.auth.limits import MAX_FAILURES
from strata.auth.sessions import SESSION_COOKIE, SESSION_TTL_S
from strata.logging_setup import setup_logging, shutdown_logging

DASH = {"X-Strata-Dashboard": "1"}
PASSWORD = "a-long-test-password-123"


@pytest.fixture
def api(client, stand_in):
    stand_in.store.add_operator("alice", PASSWORD)
    return client()


def _login(api, username="alice", password=PASSWORD, headers=DASH):
    return api.post(
        "/auth/login", json={"username": username, "password": password}, headers=headers
    )


# --- logging in ---------------------------------------------------------------------


def test_login_sets_a_locked_down_session_cookie(api):
    response = _login(api)
    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    for flag in ("HttpOnly", "Secure", "SameSite=strict", "Path=/", f"Max-Age={SESSION_TTL_S}"):
        assert flag in cookie


def test_login_needs_the_dashboard_header(api):
    assert _login(api, headers={}).status_code == 403


@pytest.mark.parametrize(
    ("username", "password"),
    [("alice", "wrong-password-123"), ("nobody", PASSWORD), ("ALICE ", "wrong-password-123")],
)
def test_a_wrong_login_gets_the_same_answer_whatever_was_wrong(api, username, password):
    response = _login(api, username, password)
    assert response.status_code == 401
    assert response.json()["detail"] == "Wrong username or password."
    assert SESSION_COOKIE not in response.headers.get("set-cookie", "")


def test_failed_logins_are_recorded(api, stand_in):
    _login(api, "alice", "wrong-password-123")
    [event] = [e for e in stand_in.store.events if e.event_type == "login_failed"]
    assert event.severity == "warning"
    assert event.details["username"] == "alice"
    assert "address" in event.details


def test_typed_usernames_are_made_safe_before_logging(api, stand_in):
    _login(api, "evil\nFAKE LOG LINE", "wrong-password-123")
    [event] = [e for e in stand_in.store.events if e.event_type == "login_failed"]
    assert "\n" not in event.details["username"]
    assert event.details["username"] == "evil?fake?log?line"


def test_successful_logins_are_audited(api, stand_in):
    _login(api)
    [entry] = stand_in.store.audit
    assert (entry.actor, entry.action) == ("alice", "login")


def test_the_session_id_never_reaches_the_logs(api, tmp_path):
    setup_logging(tmp_path, console=False)
    session_id = _login(api).cookies[SESSION_COOKIE]
    api.get("/auth/me")
    shutdown_logging()
    for name in ("strata.log", "events.jsonl"):
        assert session_id not in (tmp_path / name).read_text(encoding="utf-8")


# --- using a session ---------------------------------------------------------------------


def test_a_session_opens_the_protected_endpoints(api):
    _login(api)
    me = api.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["via"] == "session"
    assert me.json()["username"] == "alice"
    assert api.get("/system/status").status_code == 200


def test_without_a_session_or_token_nothing_is_open(api):
    assert api.get("/auth/me").status_code == 401
    assert api.get("/system/events").status_code == 401


def test_a_made_up_session_cookie_is_refused(api):
    api.cookies.set(SESSION_COOKIE, "not-a-real-session-id")
    assert api.get("/auth/me").status_code == 401


def test_changes_through_a_session_need_the_dashboard_header(api):
    _login(api)
    assert api.post("/auth/logout").status_code == 403  # no header: maybe a forged request
    assert api.get("/auth/me").status_code == 200  # still logged in


def test_logging_out_ends_the_session(api, stand_in):
    session_id = _login(api).cookies[SESSION_COOKIE]
    response = api.post("/auth/logout", headers=DASH)
    assert response.status_code == 204
    assert (
        'strata_session=""' in response.headers["set-cookie"]
        or "Max-Age=0" in response.headers["set-cookie"]
    )
    api.cookies.set(SESSION_COOKIE, session_id)  # even if the browser kept it
    assert api.get("/auth/me").status_code == 401
    assert [entry.action for entry in stand_in.store.audit] == ["login", "logout"]


def test_disabling_an_account_ends_its_sessions(api, stand_in):
    _login(api)
    stand_in.store.operators["alice"]["disabled"] = True
    assert api.get("/auth/me").status_code == 401


def test_a_password_change_ends_older_sessions(api, stand_in):
    _login(api)
    stand_in.store.operators["alice"]["valid_since"] = datetime.now(UTC) + timedelta(seconds=1)
    assert api.get("/auth/me").status_code == 401


def test_sessions_expire(api, stand_in):
    _login(api)
    stand_in.redis.advance(SESSION_TTL_S + 1)
    assert api.get("/auth/me").status_code == 401


# --- guessing ------------------------------------------------------------------------------


def test_repeated_failures_lock_the_account_for_a_while(api):
    for _ in range(MAX_FAILURES):
        assert _login(api, "alice", "wrong-password-123").status_code == 401
    response = _login(api)  # even the right password is refused now
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0


# --- when a service is down ----------------------------------------------------------------


def test_login_is_unavailable_when_redis_is_down(api, stand_in):
    stand_in.redis.down = True
    response = _login(api)
    assert response.status_code == 503
    assert "Redis" in response.json()["detail"]


def test_login_is_unavailable_when_the_database_is_down(api, stand_in):
    stand_in.store.down = True
    response = _login(api)
    assert response.status_code == 503
    assert "database" in response.json()["detail"]


def test_a_session_fails_closed_when_redis_is_down(api, stand_in):
    _login(api)
    stand_in.redis.down = True
    assert api.get("/auth/me").status_code == 503


# --- the dashboard's read endpoints ----------------------------------------------------------


@pytest.fixture
def seven_events(stand_in):
    for i in range(7):
        stand_in.store.record_event(
            f"type_{i % 2}", f"event {i}", severity="warning" if i == 3 else "info"
        )


def test_events_come_newest_first_in_pages(api, seven_events):
    _login(api)
    first = api.get("/system/events", params={"limit": 3}).json()
    assert [e["message"] for e in first["items"]] == ["event 6", "event 5", "event 4"]
    second = api.get(
        "/system/events", params={"limit": 3, "before_id": first["next_before_id"]}
    ).json()
    assert [e["message"] for e in second["items"]] == ["event 3", "event 2", "event 1"]
    last = api.get(
        "/system/events", params={"limit": 3, "before_id": second["next_before_id"]}
    ).json()
    assert [e["message"] for e in last["items"]] == ["event 0"]
    assert last["next_before_id"] is None


def test_events_can_be_filtered(api, seven_events):
    _login(api)
    warnings = api.get("/system/events", params={"severity": "warning"}).json()["items"]
    assert [e["message"] for e in warnings] == ["event 3"]
    typed = api.get("/system/events", params={"event_type": "type_1"}).json()["items"]
    assert {e["event_type"] for e in typed} == {"type_1"}


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0},
        {"limit": 1000},
        {"severity": "loud"},
        {"event_type": "has spaces"},
        {"before_id": 0},
    ],
)
def test_odd_event_queries_are_refused(api, params):
    _login(api)
    assert api.get("/system/events", params=params).status_code == 422


def test_the_audit_log_is_readable_in_pages(api, stand_in):
    _login(api)
    for i in range(4):
        stand_in.store.record_audit(actor="cli:test", action="operator_created", target_id=f"op{i}")
    page = api.get("/audit", params={"limit": 2}).json()
    assert [entry["target_id"] for entry in page["items"]] == ["op3", "op2"]
    assert page["next_before_id"] is not None
    assert api.get("/audit", params={"action": "login"}).json()["items"][0]["actor"] == "alice"


def test_read_endpoints_answer_503_when_the_database_is_down(api, stand_in):
    _login(api)
    stand_in.store.down = True
    assert api.get("/system/events").status_code == 503


@pytest.fixture
def api_with_a_change_endpoint(stand_in):
    # A stand-in for future endpoints that change things (the kill switch, for
    # example), protected only by the normal operator check.
    from fastapi import Depends
    from fastapi.testclient import TestClient

    from strata.api.app import create_app
    from strata.api.auth import require_operator

    stand_in.store.add_operator("alice", PASSWORD)
    app = create_app(stand_in.services())
    app.add_api_route(
        "/test/change",
        lambda: {"changed": True},
        methods=["POST"],
        dependencies=[Depends(require_operator)],
    )
    return TestClient(app, base_url="https://testserver")


def test_a_session_alone_cant_change_things_without_the_header(api_with_a_change_endpoint):
    api = api_with_a_change_endpoint
    _login(api)
    assert api.post("/test/change").status_code == 403
    assert api.post("/test/change", headers=DASH).status_code == 200


def test_scripts_with_the_token_dont_need_the_dashboard_header(api_with_a_change_endpoint):
    # A token is never sent automatically by a browser, so it can't be forged cross-site.
    from tests.helpers import FAKE_API_TOKEN

    response = api_with_a_change_endpoint.post(
        "/test/change", headers={"Authorization": f"Bearer {FAKE_API_TOKEN}"}
    )
    assert response.status_code == 200
