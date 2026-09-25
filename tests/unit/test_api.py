"""Tests for the HTTP API with stand-in services (no database or Redis needed)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from strata.api.app import create_app
from strata.logging_setup import setup_logging, shutdown_logging
from tests.helpers import FAKE_API_TOKEN

AUTH = {"Authorization": f"Bearer {FAKE_API_TOKEN}"}


# --- public endpoints -------------------------------------------------------------


def test_health_needs_no_token(client):
    response = client().get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_when_everything_works(client):
    response = client().get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_not_ready_when_a_part_fails(client, stand_in):
    stand_in.redis_ok = False
    response = client().get("/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable"
    assert {"name": "redis", "ok": False} in body["checks"]


def test_public_readiness_hides_error_details(client, stand_in):
    stand_in.redis_ok = False
    response = client().get("/health/ready")
    assert "ConnectionError" not in response.text
    assert "redis:6379" not in response.text


# --- the token --------------------------------------------------------------------------


def test_status_needs_a_token(client):
    response = client().get("/system/status")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "header",
    [
        f"Bearer {FAKE_API_TOKEN}x",
        f"Bearer {FAKE_API_TOKEN[:-1]}",
        "Bearer ",
        f"Basic {FAKE_API_TOKEN}",
        FAKE_API_TOKEN,
    ],
)
def test_status_refuses_a_wrong_token(client, header):
    assert client().get("/system/status", headers={"Authorization": header}).status_code == 401


def test_status_refuses_everyone_when_no_token_is_configured(client):
    response = client(token=None).get("/system/status", headers=AUTH)
    assert response.status_code == 503
    assert "ADMIN_API_TOKEN" in response.json()["detail"]


def test_failed_attempts_are_recorded(client, stand_in):
    client().get("/system/status", headers={"Authorization": "Bearer guess"})
    [event] = [e for e in stand_in.store.events if e.event_type == "auth_failed"]
    assert event.severity == "warning"
    assert event.details["path"] == "/system/status"


def test_status_with_the_token(client):
    response = client().get("/system/status", headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["component"] == "api"
    assert body["trading"]["live_trading_switch"] is False
    assert body["trading"]["default_mode"] == "paper"
    assert body["trading"]["risk_limits"]["MAX_CAPITAL"] == 300
    assert body["trading"]["risk_limits"]["max_position_value"] == 60
    assert [i["symbol"] for i in body["trading"]["instruments"]] == ["SPY", "BTC/USD"]
    assert {check["name"] for check in body["checks"]} == {"database", "schema", "redis"}


def test_the_token_is_never_sent_back(client):
    response = client().get("/system/status", headers=AUTH)
    assert FAKE_API_TOKEN not in response.text


# --- request IDs, logging, headers ------------------------------------------------------


def test_request_id_is_created_when_missing(client):
    request_id = client().get("/health").headers["X-Request-ID"]
    assert len(request_id) == 32
    assert all(ch in "0123456789abcdef" for ch in request_id)


def test_a_plain_request_id_is_kept(client):
    response = client().get("/health", headers={"X-Request-ID": "abc-123.def_4"})
    assert response.headers["X-Request-ID"] == "abc-123.def_4"


@pytest.mark.parametrize("bad", ["has spaces", "x" * 65, "semi;colon", 'quote"d'])
def test_an_odd_request_id_is_replaced(client, bad):
    response = client().get("/health", headers={"X-Request-ID": bad})
    assert response.headers["X-Request-ID"] != bad


def test_requests_are_logged_without_their_headers(client, tmp_path):
    setup_logging(tmp_path, console=False)
    wrong_token = "Wrong-Token-That-Must-Not-Be-Logged-12345"
    client().get(
        "/system/status?token=query-secret-12345",
        headers={"Authorization": f"Bearer {wrong_token}", "X-Request-ID": "req-log-1"},
    )
    shutdown_logging()
    text = "".join(
        (tmp_path / name).read_text(encoding="utf-8") for name in ("strata.log", "events.jsonl")
    )
    assert wrong_token not in text
    assert "query-secret-12345" not in text
    events = [json.loads(line) for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    request_events = [e for e in events if e["event_type"] == "http_request"]
    assert request_events[-1]["request_id"] == "req-log-1"
    assert request_events[-1]["result"] == 401
    assert request_events[-1]["details"]["path"] == "/system/status"


def test_security_headers_are_set(client):
    response = client().get("/health")
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_start_and_stop_are_recorded_and_connections_closed(stand_in):
    with TestClient(create_app(stand_in.services())) as test_client:
        test_client.get("/health")
    recorded = [event.event_type for event in stand_in.store.events]
    assert recorded[0] == "api_started"
    assert recorded[-1] == "api_stopped"
    assert stand_in.closed
