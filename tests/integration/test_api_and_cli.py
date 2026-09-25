"""The API and the `strata` command against a real PostgreSQL and Redis."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, select

from strata.api.app import build_services, create_app
from strata.cli import main
from strata.db.migrations import head_revision
from strata.db.models import AuditLog, SystemEvent
from strata.db.session import make_engine, session_factory
from strata.settings import Settings
from tests.helpers import FAKE_API_TOKEN, env_text
from tests.integration.conftest import REDIS_URL

AUTH = {"Authorization": f"Bearer {FAKE_API_TOKEN}"}


@pytest.fixture
def needs_redis():
    if not REDIS_URL:
        pytest.skip("set STRATA_TEST_REDIS_URL to run these tests (docs/DEVELOPMENT.md)")


def _settings_for(url: URL, secrets_file, config_file) -> Settings:
    return Settings(
        db_host=url.host,
        db_port=url.port or 5432,
        db_name=url.database,
        db_user=url.username,
        redis_url=REDIS_URL,
        secrets_file=secrets_file,
        config_file=config_file,
        component="api",
    )


@pytest.fixture
def api(migrated_url, needs_redis, write_env, write_config, config_dict):
    secrets = write_env(env_text(db_password=migrated_url.password))
    settings = _settings_for(migrated_url, secrets, write_config(config_dict))
    with TestClient(create_app(build_services(settings))) as client:
        yield client


def _events(url: URL, event_type: str) -> list[SystemEvent]:
    engine = make_engine(url)
    try:
        with session_factory(engine)() as session:
            query = select(SystemEvent).where(SystemEvent.event_type == event_type)
            return list(session.scalars(query))
    finally:
        engine.dispose()


def test_api_is_ready_with_real_services(api):
    response = api.get("/health/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_api_status_with_real_services(api):
    body = api.get("/system/status", headers=AUTH).json()
    assert body["status"] == "ok"
    assert {check["name"]: check["ok"] for check in body["checks"]} == {
        "database": True,
        "schema": True,
        "redis": True,
    }


def test_api_start_and_failed_logins_are_stored(api, migrated_url):
    api.get("/system/status", headers={"Authorization": "Bearer wrong"})
    assert _events(migrated_url, "api_started")
    failed = _events(migrated_url, "auth_failed")
    assert failed
    assert failed[-1].details["path"] == "/system/status"
    assert "address" in failed[-1].details


def test_cli_upgrades_an_empty_database_and_reports_healthy(
    empty_database_url, needs_redis, monkeypatch, write_env, write_config, config_dict, capsys
):
    url = empty_database_url
    monkeypatch.setenv("STRATA_DB_HOST", url.host)
    monkeypatch.setenv("STRATA_DB_PORT", str(url.port or 5432))
    monkeypatch.setenv("STRATA_DB_NAME", url.database)
    monkeypatch.setenv("STRATA_DB_USER", url.username)
    monkeypatch.setenv("STRATA_REDIS_URL", REDIS_URL)
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(write_env(env_text(db_password=url.password))))
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))

    assert main(["db", "current"]) == 1  # empty: needs migrating
    assert main(["db", "upgrade"]) == 0
    assert main(["db", "current"]) == 0
    assert main(["db", "upgrade"]) == 0  # nothing to do the second time
    assert main(["status"]) == 0
    out = capsys.readouterr().out
    assert "already up to date" in out
    assert "All checks passed." in out

    engine = make_engine(url)
    try:
        with session_factory(engine)() as session:
            # Only the real change is audited, not the second, empty run.
            audit = session.scalars(select(AuditLog).where(AuditLog.action == "db_upgrade")).one()
    finally:
        engine.dispose()
    assert audit.details == {"from": None, "to": head_revision()}
