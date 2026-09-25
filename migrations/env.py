"""Alembic environment for STRATA.

The database address is built from STRATA_ settings plus the password in the
.env secrets file, never read from alembic.ini. Run migrations with
`strata db upgrade`.
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import Connection, create_engine, pool

from strata.db import models  # noqa: F401  (imported so the tables are registered)
from strata.db.base import Base

config = context.config
target_metadata = Base.metadata


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = config.attributes.get("url")
    if url is None:
        from strata.db.session import url_from_environment

        url = url_from_environment()
    engine = create_engine(url, poolclass=pool.NullPool)
    try:
        with engine.connect() as connection:
            _run(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline (SQL script) migrations aren't supported; use `strata db upgrade`.")
run_migrations_online()
