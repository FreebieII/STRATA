"""The `strata` command.

    strata status        settings summary and database / Redis health
    strata db upgrade    bring the database schema up to date
    strata db current    show which migration the database is at
    strata api           run the HTTP API

(`python -m strata ...` does the same.) Trading commands arrive in later
phases; until then `python main.py` runs the Stage 1 start-up checks.

Exit codes: 0 fine, 1 a health check failed, 2 refused to start (bad
settings, missing secrets).
"""

from __future__ import annotations

import argparse
import logging
import sys
from urllib.parse import urlsplit, urlunsplit

from . import __version__
from .config import Config, ConfigError, load_config
from .credentials import (
    CredentialsError,
    live_trading_switch_on,
    load_database_password,
    read_env_file,
    secret_values,
)
from .db.migrations import current_revision, head_revision, upgrade
from .db.records import record_audit, record_system_event
from .db.session import database_url, engine_from_settings, safe_url, session_factory
from .health import ComponentHealth, check_database, check_redis, check_schema
from .logging_setup import log_event, register_secrets, setup_logging
from .redis_client import make_redis
from .settings import Settings, SettingsError, load_settings
from .version import code_version

EXIT_OK = 0
EXIT_UNHEALTHY = 1
EXIT_REFUSED = 2

log = logging.getLogger("strata.cli")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="strata", description="STRATA trading platform. Paper trading by default."
    )
    parser.add_argument("--version", action="version", version=f"strata {__version__}")
    commands = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    commands.add_parser("status", help="show settings and check the database and Redis")

    db = commands.add_parser("db", help="database migrations")
    db_commands = db.add_subparsers(dest="db_command", required=True, metavar="ACTION")
    db_commands.add_parser("upgrade", help="bring the database schema up to date")
    db_commands.add_parser("current", help="show which migration the database is at")

    api = commands.add_parser("api", help="run the HTTP API")
    api.add_argument("--host", help="address to listen on (default: STRATA_API_HOST)")
    api.add_argument("--port", type=int, help="port to listen on (default: STRATA_API_PORT)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = load_settings()
        config = load_config(settings.config_file)
        env = read_env_file(settings.secrets_file)
        register_secrets(*secret_values(env))
    except (SettingsError, ConfigError, CredentialsError) as exc:
        print(f"Not started: {exc}", file=sys.stderr)
        return EXIT_REFUSED

    setup_logging(
        config.paths.logs_dir,
        config.logging.level,
        tz=config.tz,
        console=args.command == "api",
        component=settings.component,
        console_format=settings.log_format,
    )
    try:
        if args.command == "status":
            return _status(settings, config, env)
        if args.command == "db":
            return _db(args.db_command, settings, env)
        return _api(settings, args.host, args.port)
    except CredentialsError as exc:
        print(f"Not started: {exc}", file=sys.stderr)
        return EXIT_REFUSED


# --- status ------------------------------------------------------------------------


def _status(settings: Settings, config: Config, env: dict[str, str]) -> int:
    version = code_version(settings.git_commit)
    commit = (version["git_commit"] or "unknown")[:12]
    risk = config.risk
    print(f"STRATA {version['version']} (commit {commit})\n")
    print("Settings")
    print(f"  config file    {settings.config_file}")
    print(f"  secrets file   {settings.secrets_file}")
    password = env.get("POSTGRES_PASSWORD") or "(not set)"
    print(f"  database       {safe_url(database_url(settings, password))}")
    print(f"  redis          {_safe_redis_url(settings.redis_url)}")
    print("\nTrading")
    switch = "ON" if live_trading_switch_on(env) else "OFF"
    print(f"  live trading switch  {switch} (live mode also needs --live and a typed phrase)")
    instruments = ", ".join(
        f"{i.symbol} ({i.asset_class}, {i.strategy}{'' if i.enabled else ', disabled'})"
        for i in config.instruments
    )
    print(f"  instruments          {instruments}")
    print(
        f"  risk limits          MAX_CAPITAL ${risk.MAX_CAPITAL:,.2f}, "
        f"max position ${risk.max_position_value:,.2f}, stop loss {risk.STOP_LOSS_PCT:g}%, "
        f"daily loss ${risk.DAILY_LOSS_LIMIT:,.2f}, total loss ${risk.TOTAL_LOSS_LIMIT:,.2f}, "
        f"{risk.MAX_TRADES_PER_DAY} trades/day"
    )

    print("\nHealth")
    checks = _health_checks(settings, env)
    for check in checks:
        tag = "[ OK ]" if check.ok else "[FAIL]"
        timing = f" ({check.latency_ms} ms)" if check.latency_ms is not None else ""
        print(f"  {tag} {check.name}: {check.detail}{timing}")
    healthy = all(check.ok for check in checks)
    print("\nAll checks passed." if healthy else "\nSome checks failed: see [FAIL] above.")
    return EXIT_OK if healthy else EXIT_UNHEALTHY


def _health_checks(settings: Settings, env: dict[str, str]) -> list[ComponentHealth]:
    checks = []
    try:
        engine = engine_from_settings(settings, load_database_password(env))
    except CredentialsError as exc:
        checks.append(ComponentHealth("database", False, str(exc)))
    else:
        try:
            checks.append(check_database(engine))
            if checks[-1].ok:
                checks.append(check_schema(engine))
        finally:
            engine.dispose()
    client = make_redis(settings.redis_url, settings.redis_timeout_s)
    try:
        checks.append(check_redis(client))
    finally:
        client.close()
    return checks


def _safe_redis_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.password:
        netloc = f"{parts.username or ''}:***@{parts.hostname}"
        if parts.port:
            netloc += f":{parts.port}"
        return urlunsplit(parts._replace(netloc=netloc))
    return url


# --- db --------------------------------------------------------------------------------


def _db(action: str, settings: Settings, env: dict[str, str]) -> int:
    password = load_database_password(env)
    url = database_url(settings, password)
    engine = engine_from_settings(settings, password)
    try:
        health = check_database(engine)
        if not health.ok:
            print(f"Database unavailable: {health.detail}", file=sys.stderr)
            return EXIT_UNHEALTHY
        before = current_revision(engine)
        expected = head_revision()
        if action == "current":
            print(f"database at migration {before or 'none'}; newest in the code: {expected}")
            return EXIT_OK if before == expected else EXIT_UNHEALTHY

        upgrade(url)
        after = current_revision(engine)
        with session_factory(engine).begin() as session:
            record_audit(
                session,
                actor="operator",
                action="db_upgrade",
                target_type="database",
                target_id=settings.db_name,
                details={"from": before, "to": after},
            )
            record_system_event(
                session,
                component=settings.component,
                event_type="db_upgrade",
                message=f"database migrated from {before or 'empty'} to {after}",
            )
        log_event("db_upgrade", f"database migrated from {before or 'empty'} to {after}")
        print(f"Database is up to date (migration {after}).")
        return EXIT_OK
    finally:
        engine.dispose()


# --- api -------------------------------------------------------------------------------


def _api(settings: Settings, host: str | None, port: int | None) -> int:
    import uvicorn

    from .api.app import build_services, create_app

    services = build_services(settings)
    app = create_app(services)
    uvicorn.run(
        app,
        host=host or settings.api_host,
        port=port or settings.api_port,
        log_config=None,  # keep STRATA's logging (and its secret redaction)
        access_log=False,  # requests are logged by STRATA without headers
        server_header=False,
    )
    return EXIT_OK
