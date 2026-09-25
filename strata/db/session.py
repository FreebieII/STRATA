"""Connecting to PostgreSQL.

The address (host, port, database, user) comes from STRATA_ settings and the
password from the .env secrets file. Every connection has time limits:

    connect timeout      give up connecting after db_connect_timeout_s seconds
    statement timeout    PostgreSQL cancels any statement running longer than
                         db_statement_timeout_ms

so a stuck database makes an operation fail (and STRATA stop trading) rather
than freeze. Addresses are only ever printed with the password hidden.
"""

from __future__ import annotations

from sqlalchemy import URL, Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..credentials import load_database_password, read_env_file
from ..settings import Settings, load_settings


def database_url(settings: Settings, password: str) -> URL:
    """The full database address, with the password safely escaped."""
    return URL.create(
        "postgresql+psycopg",
        username=settings.db_user,
        password=password,
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
    )


def url_from_environment(settings: Settings | None = None) -> URL:
    """The database address from STRATA_ settings plus the password in the secrets file."""
    settings = settings or load_settings()
    env = read_env_file(settings.secrets_file)
    return database_url(settings, load_database_password(env))


def safe_url(url: URL | str) -> str:
    """The address with the password replaced by ***, safe to print or log."""
    if isinstance(url, str):
        from sqlalchemy.engine import make_url

        url = make_url(url)
    return url.render_as_string(hide_password=True)


def make_engine(
    url: URL | str,
    *,
    connect_timeout_s: int = 5,
    statement_timeout_ms: int = 15_000,
    application_name: str = "strata",
) -> Engine:
    """A connection pool with time limits on connecting and on every statement."""
    return create_engine(
        url,
        pool_pre_ping=True,  # replace connections that died while idle
        pool_size=5,
        max_overflow=5,
        pool_timeout=10,  # wait at most 10 s for a free connection
        pool_recycle=1800,
        connect_args={
            "connect_timeout": connect_timeout_s,
            "options": f"-c statement_timeout={statement_timeout_ms}",
            "application_name": application_name,
        },
    )


def engine_from_settings(settings: Settings, password: str) -> Engine:
    return make_engine(
        database_url(settings, password),
        connect_timeout_s=settings.db_connect_timeout_s,
        statement_timeout_ms=settings.db_statement_timeout_ms,
        application_name=f"strata-{settings.component}",
    )


def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)
