"""Fixtures for tests that need a real PostgreSQL and Redis.

Set these to run them (docs/DEVELOPMENT.md shows how):

    STRATA_TEST_DATABASE_URL  e.g. postgresql+psycopg://user:pass@127.0.0.1:5432/postgres
                              (the user must be allowed to create databases)
    STRATA_TEST_REDIS_URL     e.g. redis://127.0.0.1:6379/15

Without them these tests are skipped. Each test session creates its own
throwaway database, applies the real migrations to it, and drops it at the end,
so no real data is ever touched.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from sqlalchemy import URL, Engine, create_engine, make_url, pool, text
from sqlalchemy.orm import Session

from strata.db.migrations import upgrade
from strata.db.session import make_engine
from strata.redis_client import make_redis

DATABASE_URL = os.environ.get("STRATA_TEST_DATABASE_URL")
REDIS_URL = os.environ.get("STRATA_TEST_REDIS_URL")


def pytest_collection_modifyitems(items):
    for item in items:
        if "tests/integration/" in item.nodeid.replace("\\", "/"):
            item.add_marker(pytest.mark.integration)


def _admin_engine() -> Engine:
    if not DATABASE_URL:
        pytest.skip("set STRATA_TEST_DATABASE_URL to run database tests (docs/DEVELOPMENT.md)")
    return create_engine(DATABASE_URL, isolation_level="AUTOCOMMIT", poolclass=pool.NullPool)


def create_throwaway_database() -> URL:
    name = f"strata_test_{uuid.uuid4().hex[:12]}"
    admin = _admin_engine()
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return make_url(DATABASE_URL).set(database=name)


def drop_database(url: URL) -> None:
    admin = _admin_engine()
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture(scope="session")
def migrated_url() -> Iterator[URL]:
    """A throwaway database with every migration applied, shared by the session."""
    url = create_throwaway_database()
    try:
        upgrade(url)
        yield url
    finally:
        drop_database(url)


@pytest.fixture
def empty_database_url() -> Iterator[URL]:
    """A throwaway database with nothing in it, for one test."""
    url = create_throwaway_database()
    try:
        yield url
    finally:
        drop_database(url)


@pytest.fixture
def engine(migrated_url: URL) -> Iterator[Engine]:
    engine = make_engine(migrated_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Iterator[Session]:
    """A session whose changes are rolled back after the test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def redis_client():
    if not REDIS_URL:
        pytest.skip("set STRATA_TEST_REDIS_URL to run Redis tests (docs/DEVELOPMENT.md)")
    client = make_redis(REDIS_URL, timeout_s=2)
    yield client
    client.close()
