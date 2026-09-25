"""Operator accounts, the `strata operator` command and dashboard login,
against a real PostgreSQL and Redis."""

from __future__ import annotations

import io
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from strata.api.app import build_services, create_app
from strata.auth.operators import (
    OperatorError,
    authenticate,
    create_operator,
    reset_password,
    set_disabled,
)
from strata.auth.passwords import WeakPasswordError
from strata.cli import main
from strata.db.models import AuditLog, Operator
from strata.db.session import make_engine, session_factory
from strata.settings import Settings
from tests.helpers import env_text
from tests.integration.conftest import REDIS_URL

PASSWORD = "integration-test-pass-42"
DASH = {"X-Strata-Dashboard": "1"}


def _name() -> str:
    return f"op{uuid.uuid4().hex[:10]}"


# --- accounts ----------------------------------------------------------------------


def test_an_operator_account_through_its_life(db_session):
    name = _name()
    create_operator(db_session, name.upper(), PASSWORD, actor="test")  # stored lowercase
    assert authenticate(db_session, name, PASSWORD).username == name
    assert authenticate(db_session, name, "wrong-password-000") is None

    set_disabled(db_session, name, True, actor="test")
    assert authenticate(db_session, name, PASSWORD) is None
    set_disabled(db_session, name, False, actor="test")

    reset_password(db_session, name, "another-good-pass-99", actor="test")
    assert authenticate(db_session, name, PASSWORD) is None
    assert authenticate(db_session, name, "another-good-pass-99") is not None

    actions = db_session.scalars(
        select(AuditLog.action).where(AuditLog.target_id == name).order_by(AuditLog.id)
    ).all()
    assert actions == [
        "operator_created",
        "operator_disabled",
        "operator_enabled",
        "operator_password_reset",
    ]


def test_passwords_are_stored_only_as_hashes(db_session):
    name = _name()
    create_operator(db_session, name, PASSWORD, actor="test")
    stored = db_session.scalars(
        select(Operator.password_hash).where(Operator.username == name)
    ).one()
    assert stored.startswith("scrypt$")
    assert PASSWORD not in stored


def test_the_same_username_twice_is_refused(db_session):
    name = _name()
    create_operator(db_session, name, PASSWORD, actor="test")
    with pytest.raises(OperatorError, match="already exists"):
        create_operator(db_session, name, PASSWORD, actor="test")


@pytest.mark.parametrize("bad", ["ab", "has space", "-starts-with-dash", "x" * 65, "émile"])
def test_odd_usernames_are_refused(db_session, bad):
    with pytest.raises(OperatorError, match="Usernames"):
        create_operator(db_session, bad, PASSWORD, actor="test")


def test_weak_passwords_are_refused(db_session):
    with pytest.raises(WeakPasswordError):
        create_operator(db_session, _name(), "short", actor="test")


def test_the_database_refuses_odd_usernames_too(db_session):
    db_session.add(Operator(username="Bad Name", password_hash="x"))
    with pytest.raises(IntegrityError):
        db_session.flush()


# --- the strata operator command ---------------------------------------------------------------


@pytest.fixture
def cli_env(migrated_url, monkeypatch, write_env, write_config, config_dict):
    if not REDIS_URL:
        pytest.skip("set STRATA_TEST_REDIS_URL to run these tests (docs/DEVELOPMENT.md)")
    monkeypatch.setenv("STRATA_DB_HOST", migrated_url.host)
    monkeypatch.setenv("STRATA_DB_PORT", str(migrated_url.port or 5432))
    monkeypatch.setenv("STRATA_DB_NAME", migrated_url.database)
    monkeypatch.setenv("STRATA_DB_USER", migrated_url.username)
    monkeypatch.setenv("STRATA_REDIS_URL", REDIS_URL)
    monkeypatch.setenv(
        "STRATA_SECRETS_FILE", str(write_env(env_text(db_password=migrated_url.password)))
    )
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))
    return monkeypatch


def _type(monkeypatch, text: str) -> None:
    monkeypatch.setattr("sys.stdin", io.StringIO(text + "\n"))


def test_the_operator_command(cli_env, capsys):
    name = _name()
    _type(cli_env, PASSWORD)
    assert main(["operator", "create", name, "--password-stdin"]) == 0
    assert main(["operator", "list"]) == 0
    listing = capsys.readouterr().out
    assert name in listing
    assert "active" in listing

    _type(cli_env, PASSWORD)
    assert main(["operator", "create", name, "--password-stdin"]) == 2  # duplicate
    _type(cli_env, "short")
    assert main(["operator", "reset-password", name, "--password-stdin"]) == 2  # weak
    assert main(["operator", "disable", name]) == 0
    assert "Ended 0 dashboard session(s)." in capsys.readouterr().out
    assert main(["operator", "list"]) == 0
    assert "disabled" in capsys.readouterr().out
    assert main(["operator", "enable", "nobody-here"]) == 2


# --- logging in through the API -------------------------------------------------------------


@pytest.fixture
def login_api(migrated_url, write_env, write_config, config_dict):
    if not REDIS_URL:
        pytest.skip("set STRATA_TEST_REDIS_URL to run these tests (docs/DEVELOPMENT.md)")
    name = _name()
    engine = make_engine(migrated_url)
    with session_factory(engine).begin() as session:
        create_operator(session, name, PASSWORD, actor="test")
    settings = Settings(
        db_host=migrated_url.host,
        db_port=migrated_url.port or 5432,
        db_name=migrated_url.database,
        db_user=migrated_url.username,
        redis_url=REDIS_URL,
        secrets_file=write_env(env_text(db_password=migrated_url.password)),
        config_file=write_config(config_dict),
        component="api",
    )
    with TestClient(create_app(build_services(settings)), base_url="https://testserver") as client:
        yield client, name, engine
    engine.dispose()


def test_logging_in_with_real_services(login_api):
    api, name, _engine = login_api
    response = api.post("/auth/login", json={"username": name, "password": PASSWORD}, headers=DASH)
    assert response.status_code == 200
    assert api.get("/auth/me").json()["username"] == name
    events = api.get("/system/events").json()["items"]
    assert any(event["event_type"] == "api_started" for event in events)
    audit = api.get("/audit", params={"action": "login"}).json()["items"]
    assert audit[0]["actor"] == name


def test_a_password_reset_ends_a_real_session(login_api):
    api, name, engine = login_api
    api.post("/auth/login", json={"username": name, "password": PASSWORD}, headers=DASH)
    with session_factory(engine).begin() as session:
        reset_password(session, name, "brand-new-password-77", actor="test")
    assert api.get("/auth/me").status_code == 401


def test_a_wrong_password_is_stored_as_a_system_event(login_api):
    api, name, _engine = login_api
    api.post("/auth/login", json={"username": name, "password": "nope-nope-nope"}, headers=DASH)
    api.post("/auth/login", json={"username": name, "password": PASSWORD}, headers=DASH)
    failures = api.get("/system/events", params={"event_type": "login_failed"}).json()["items"]
    assert any(event["details"]["username"] == name for event in failures)
