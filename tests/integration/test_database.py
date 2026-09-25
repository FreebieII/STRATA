"""Tests against a real PostgreSQL: migrations, tables, audit protection, time limits."""

from __future__ import annotations

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError

from strata.db.migrations import (
    check_models_match,
    current_revision,
    downgrade,
    head_revision,
    upgrade,
)
from strata.db.models import AuditLog, SystemEvent
from strata.db.records import record_audit, record_system_event
from strata.db.session import make_engine
from strata.health import check_database, check_schema
from strata.logging_setup import register_secrets
from tests.helpers import FAKE_DB_PASSWORD

# --- migrations -------------------------------------------------------------------


def test_migrations_create_the_tables(engine):
    tables = set(inspect(engine).get_table_names())
    assert {"system_events", "audit_logs", "alembic_version"} <= tables
    assert current_revision(engine) == head_revision()


def test_models_and_migrations_agree(migrated_url):
    # Fails if someone changes models.py without writing a migration.
    check_models_match(migrated_url)


def test_migrations_can_be_undone_and_redone(empty_database_url):
    upgrade(empty_database_url)
    downgrade(empty_database_url, "base")
    engine = make_engine(empty_database_url)
    try:
        assert "audit_logs" not in inspect(engine).get_table_names()
        upgrade(empty_database_url)
        assert current_revision(engine) == head_revision()
    finally:
        engine.dispose()


def test_schema_check_spots_a_database_that_needs_migrating(empty_database_url):
    engine = make_engine(empty_database_url)
    try:
        result = check_schema(engine)
        assert not result.ok
        assert "strata db upgrade" in result.detail
        upgrade(empty_database_url)
        assert check_schema(engine).ok
    finally:
        engine.dispose()


# --- system events ------------------------------------------------------------------


def test_system_events_are_stored(db_session):
    record_system_event(
        db_session,
        component="api",
        event_type="api_started",
        message="API started",
        details={"version": "0.1.0"},
        request_id="req-123",
    )
    db_session.flush()
    stored = db_session.scalars(
        select(SystemEvent).where(SystemEvent.request_id == "req-123")
    ).one()
    assert stored.event_type == "api_started"
    assert stored.severity == "info"
    assert stored.details == {"version": "0.1.0"}
    assert stored.occurred_at is not None


def test_unknown_severity_is_refused_by_the_code(db_session):
    with pytest.raises(ValueError, match="unknown severity"):
        record_system_event(
            db_session, component="api", event_type="x", message="x", severity="loud"
        )


def test_unknown_severity_is_refused_by_the_database(db_session):
    db_session.add(SystemEvent(component="api", event_type="x", message="x", severity="loud"))
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_secrets_are_hidden_before_storing(db_session):
    register_secrets(FAKE_DB_PASSWORD)
    record_system_event(
        db_session,
        component="api",
        event_type="login_failed",
        message=f"password {FAKE_DB_PASSWORD} rejected",
        details={"attempt": FAKE_DB_PASSWORD},
        request_id="req-secret",
    )
    db_session.flush()
    stored = db_session.scalars(
        select(SystemEvent).where(SystemEvent.request_id == "req-secret")
    ).one()
    assert FAKE_DB_PASSWORD not in stored.message
    assert FAKE_DB_PASSWORD not in str(stored.details)


# --- the audit log is append-only ------------------------------------------------------


def _audit_row(engine) -> int:
    with engine.begin() as connection:
        return connection.execute(
            text("INSERT INTO audit_logs (actor, action) VALUES ('test', 'check') RETURNING id")
        ).scalar_one()


def test_audit_entries_are_stored(db_session):
    record_audit(
        db_session,
        actor="operator",
        action="kill_switch_on",
        target_type="system",
        details={"reason": "manual test"},
        request_id="req-audit",
    )
    db_session.flush()
    stored = db_session.scalars(select(AuditLog).where(AuditLog.request_id == "req-audit")).one()
    assert stored.actor == "operator"
    assert stored.details == {"reason": "manual test"}


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_logs SET action = 'changed' WHERE id = :id",
        "DELETE FROM audit_logs WHERE id = :id",
        "TRUNCATE audit_logs",
    ],
)
def test_audit_log_history_cannot_be_changed(engine, statement):
    row_id = _audit_row(engine)
    with pytest.raises(DBAPIError, match="append-only"), engine.begin() as connection:
        connection.execute(text(statement), {"id": row_id})
    with engine.connect() as connection:  # the row is still there, unchanged
        action = connection.execute(
            text("SELECT action FROM audit_logs WHERE id = :id"), {"id": row_id}
        ).scalar_one()
    assert action == "check"


# --- time limits and health ------------------------------------------------------------


def test_slow_statements_are_cancelled(migrated_url):
    engine = make_engine(migrated_url, statement_timeout_ms=200)
    try:
        with pytest.raises(OperationalError, match="statement timeout"), engine.connect() as c:
            c.execute(text("SELECT pg_sleep(3)"))
    finally:
        engine.dispose()


def test_health_check_passes_for_a_working_database(engine):
    result = check_database(engine)
    assert result.ok
    assert result.latency_ms is not None


def test_health_check_fails_safely_with_a_wrong_password(migrated_url):
    wrong = migrated_url.set(password="definitely-not-the-password")
    engine = make_engine(wrong, connect_timeout_s=2)
    try:
        result = check_database(engine)
    finally:
        engine.dispose()
    assert not result.ok
    assert "definitely-not-the-password" not in result.detail


def test_health_check_fails_quickly_when_the_database_is_unreachable():
    engine = make_engine(
        "postgresql+psycopg://nobody:nothing@127.0.0.1:1/none", connect_timeout_s=2
    )
    try:
        result = check_database(engine)
    finally:
        engine.dispose()
    assert not result.ok
    assert "OperationalError" in result.detail
