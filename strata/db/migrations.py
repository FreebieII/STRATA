"""Applying the database migrations (the Alembic scripts in /migrations).

strata db upgrade    bring the database up to date
strata db current    show which migration the database is at
"""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import URL, Engine

from .. import PROJECT_ROOT

ALEMBIC_INI = PROJECT_ROOT / "alembic.ini"


def alembic_config(url: URL | None = None) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(PROJECT_ROOT / "migrations"))
    if url is not None:
        config.attributes["url"] = url  # used by migrations/env.py
    return config


def upgrade(url: URL, revision: str = "head") -> None:
    command.upgrade(alembic_config(url), revision)


def downgrade(url: URL, revision: str) -> None:
    command.downgrade(alembic_config(url), revision)


def check_models_match(url: URL) -> None:
    """Raise if the tables in models.py differ from what the migrations create."""
    command.check(alembic_config(url))


def head_revision() -> str | None:
    """The newest migration in the code."""
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision(engine: Engine) -> str | None:
    """The migration the database is at, or None for an empty database."""
    with engine.connect() as connection:
        revision: str | None = MigrationContext.configure(connection).get_current_revision()
        return revision
