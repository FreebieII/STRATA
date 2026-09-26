"""Tests for infrastructure settings from STRATA_ variables (strata/settings.py)."""

from __future__ import annotations

from pathlib import Path

import pytest

from strata.settings import Settings, SettingsError, load_settings, unknown_variables


def test_defaults_keep_everything_on_this_computer():
    settings = load_settings()
    assert settings.db_host == "127.0.0.1"
    assert settings.redis_url.startswith("redis://127.0.0.1")
    assert settings.api_host == "127.0.0.1"  # never all interfaces by default
    assert settings.component == "cli"
    assert settings.log_format == "text"


def test_variables_override_defaults(monkeypatch):
    monkeypatch.setenv("STRATA_DB_HOST", "postgres")
    monkeypatch.setenv("STRATA_DB_PORT", "6543")
    monkeypatch.setenv("STRATA_LOG_FORMAT", "json")
    monkeypatch.setenv("STRATA_SECRETS_FILE", "/run/secrets/strata_env")
    settings = load_settings()
    assert settings.db_host == "postgres"
    assert settings.db_port == 6543
    assert settings.log_format == "json"
    assert settings.secrets_file == Path("/run/secrets/strata_env")


def test_misspelled_variable_is_refused(monkeypatch):
    monkeypatch.setenv("STRATA_DB_HOTS", "postgres")
    with pytest.raises(SettingsError, match="STRATA_DB_HOTS"):
        load_settings()


def test_test_suite_variables_are_not_settings():
    assert unknown_variables({"STRATA_TEST_DATABASE_URL": "x", "PATH": "/bin"}) == []


def test_compose_and_browser_test_variables_are_not_typos():
    environ = {
        "STRATA_UID": "1000",
        "STRATA_GID": "1000",
        "STRATA_SECRETS_PATH": "./.env",
        "STRATA_CERTS_DIR": "./certs",
        "STRATA_DASHBOARD_BIND": "192.168.1.50",
        "STRATA_DASHBOARD_PORT": "8443",
        "STRATA_E2E_PASSWORD": "x",
    }
    assert unknown_variables(environ) == []
    # ...but a misspelling of one still is.
    assert unknown_variables({"STRATA_DASHBOARD_BINDS": "x"}) == ["STRATA_DASHBOARD_BINDS"]


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("STRATA_DB_PORT", "99999"),
        ("STRATA_DB_PORT", "not-a-number"),
        ("STRATA_LOG_FORMAT", "xml"),
        ("STRATA_REDIS_URL", "http://example.com"),
        ("STRATA_COMPONENT", "Has Spaces"),
        ("STRATA_GIT_COMMIT", "not-a-hash"),
        ("STRATA_DB_STATEMENT_TIMEOUT_MS", "0"),
    ],
)
def test_invalid_values_are_refused(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(SettingsError, match=name):
        load_settings()


def test_settings_are_read_only():
    settings = Settings()
    with pytest.raises(Exception, match="frozen"):
        settings.db_host = "elsewhere"
