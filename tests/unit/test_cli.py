"""Tests for the `strata` command, without a database or Redis.

Services are pointed at closed ports on this computer, so every check fails
at once; that shows the failure paths are reported safely.
"""

from __future__ import annotations

import pytest

from strata import __version__
from strata.cli import EXIT_REFUSED, EXIT_UNHEALTHY, _safe_redis_url, build_parser, main
from tests.helpers import FAKE_DB_PASSWORD, env_text


@pytest.fixture
def unreachable(monkeypatch, config_dict, write_config, write_env):
    """STRATA settings for services that aren't running."""
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(write_env(env_text())))
    monkeypatch.setenv("STRATA_DB_PORT", "1")
    monkeypatch.setenv("STRATA_DB_CONNECT_TIMEOUT_S", "2")
    monkeypatch.setenv("STRATA_REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setenv("STRATA_REDIS_TIMEOUT_S", "1")


def test_a_command_is_required():
    with pytest.raises(SystemExit):
        build_parser().parse_args([])


def test_version(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--version"])
    assert __version__ in capsys.readouterr().out


def test_misspelled_setting_refuses_to_start(monkeypatch, capsys):
    monkeypatch.setenv("STRATA_DB_HOTS", "x")
    assert main(["status"]) == EXIT_REFUSED
    assert "STRATA_DB_HOTS" in capsys.readouterr().err


def test_missing_secrets_file_refuses_to_start(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(tmp_path / "missing.env"))
    assert main(["status"]) == EXIT_REFUSED
    assert "cp .env.example .env" in capsys.readouterr().err


def test_status_reports_failures_and_hides_the_password(unreachable, capsys):
    assert main(["status"]) == EXIT_UNHEALTHY
    out = capsys.readouterr().out
    assert "[FAIL] database" in out
    assert "[FAIL] redis" in out
    assert "strata:***@127.0.0.1:1/strata" in out
    assert FAKE_DB_PASSWORD not in out
    assert "live trading switch  OFF" in out


def test_db_commands_report_an_unreachable_database(unreachable, capsys):
    assert main(["db", "current"]) == EXIT_UNHEALTHY
    assert "Database unavailable" in capsys.readouterr().err


def test_db_commands_need_the_database_password(unreachable, monkeypatch, write_env, capsys):
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(write_env(env_text(db_password=""))))
    assert main(["db", "upgrade"]) == EXIT_REFUSED
    assert "POSTGRES_PASSWORD" in capsys.readouterr().err


def test_market_data_is_not_fetched_without_the_database(
    unreachable, monkeypatch, config_dict, write_config, tmp_path, capsys
):
    config_dict["paths"]["data_dir"] = str(tmp_path / "data")
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))
    # Every download is recorded, so with no database nothing is downloaded or cached.
    assert main(["data", "fetch", "--mock"]) == EXIT_UNHEALTHY
    assert "nothing was done" in capsys.readouterr().err
    assert not (tmp_path / "data").exists()


def test_market_data_dates_must_be_real_days(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args(["data", "fetch", "--from", "2024-02-30"])
    assert "isn't a date like 2024-07-01" in capsys.readouterr().err


def test_redis_passwords_are_hidden():
    assert _safe_redis_url("redis://:pw123@redis:6379/0") == "redis://:***@redis:6379/0"
    assert _safe_redis_url("redis://127.0.0.1:6379/0") == "redis://127.0.0.1:6379/0"
