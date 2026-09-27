"""The `strata` command.

    strata status                    settings summary and database / Redis health
    strata db upgrade                bring the database schema up to date
    strata db current                show which migration the database is at
    strata api                       run the HTTP API
    strata operator create NAME      create a dashboard account (asks for a password)
    strata operator list             show the dashboard accounts
    strata operator reset-password NAME / disable NAME / enable NAME
    strata data fetch                download daily prices, check them, cache and record them
    strata data check                check every cached file against its recorded hash

(`python -m strata ...` does the same.) Trading commands arrive in later
phases (see BUILD_PLAN.md); until then `python main.py` runs the original
start-up checks for backtest, paper and live mode.

Exit codes: 0 fine, 1 a health check failed, 2 refused to start (bad
settings, missing secrets).
"""

from __future__ import annotations

import argparse
import getpass
import logging
import sys
from collections.abc import Callable
from datetime import UTC, date
from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

from . import __version__
from .auth.operators import (
    OperatorError,
    create_operator,
    list_operators,
    normalise_username,
    reset_password,
    set_disabled,
)
from .auth.passwords import MIN_PASSWORD_LENGTH, WeakPasswordError
from .auth.sessions import SessionStore
from .config import Config, ConfigError, load_config
from .credentials import (
    CredentialsError,
    live_trading_switch_on,
    load_database_password,
    load_paper_keys,
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

if TYPE_CHECKING:
    from .market_data.cache import BarCache
    from .market_data.records import MetadataStore

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

    operator = commands.add_parser("operator", help="dashboard accounts")
    operator_commands = operator.add_subparsers(
        dest="operator_command", required=True, metavar="ACTION"
    )
    for action, help_text in (
        ("create", "create an account; asks for its password"),
        ("reset-password", "set a new password; ends the account's dashboard sessions"),
    ):
        command = operator_commands.add_parser(action, help=help_text)
        command.add_argument("username")
        command.add_argument(
            "--password-stdin",
            action="store_true",
            help="read the password from standard input instead of asking (for scripts)",
        )
    for action, help_text in (
        ("disable", "stop an account from logging in; ends its dashboard sessions"),
        ("enable", "let a disabled account log in again"),
    ):
        operator_commands.add_parser(action, help=help_text).add_argument("username")
    operator_commands.add_parser("list", help="show all accounts")

    data = commands.add_parser("data", help="market data: download, check, cache and record prices")
    data_commands = data.add_subparsers(dest="data_command", required=True, metavar="ACTION")
    fetch = data_commands.add_parser(
        "fetch", help="download daily bars, check them, and cache and record the good ones"
    )
    fetch.add_argument(
        "--symbol", help="one instrument from config.yaml (default: every enabled one)"
    )
    fetch.add_argument(
        "--from",
        dest="start",
        type=_day,
        help="first day, YYYY-MM-DD (default: backtest.start_date)",
    )
    fetch.add_argument(
        "--to",
        dest="end",
        type=_day,
        help="last day, YYYY-MM-DD (default: backtest.end_date, or the latest finished day)",
    )
    fetch.add_argument(
        "--mock",
        action="store_true",
        help="made-up prices instead of Alpaca: no keys needed, always marked as mock",
    )
    data_commands.add_parser("check", help="check every cached file against its recorded hash")

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
        if args.command == "operator":
            return _operator(args, settings, env)
        if args.command == "data":
            return _data(args, settings, config, env)
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

        if before == expected:
            print(f"Database is already up to date (migration {before}).")
            return EXIT_OK

        upgrade(url)
        after = current_revision(engine)
        # Only real changes go in the audit log.
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


# --- data ------------------------------------------------------------------------------


def _day(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{text!r} isn't a date like 2024-07-01") from None


def _data(args: argparse.Namespace, settings: Settings, config: Config, env: dict[str, str]) -> int:
    from .market_data.cache import BarCache
    from .market_data.records import DatabaseMetadataStore

    cache = BarCache(config.paths.data_dir / "market")
    engine = engine_from_settings(settings, load_database_password(env))
    try:
        for check in (check_database, check_schema):
            health = check(engine)
            if not health.ok:
                print(
                    f"The {health.name} isn't ready ({health.detail}). Every download is recorded "
                    "in the database, so nothing was done. Run `strata status`.",
                    file=sys.stderr,
                )
                return EXIT_UNHEALTHY
        metadata = DatabaseMetadataStore(session_factory(engine), component=settings.component)
        if args.data_command == "check":
            return _data_check(cache, metadata)
        return _data_fetch(args, config, env, cache, metadata)
    finally:
        engine.dispose()


def _data_fetch(
    args: argparse.Namespace,
    config: Config,
    env: dict[str, str],
    cache: BarCache,
    metadata: MetadataStore,
) -> int:
    from .alpaca_clients import crypto_data_client, stock_data_client, trading_client
    from .market_data.alpaca import AlpacaMarketData
    from .market_data.calendars import AlpacaCalendar, EveryDay, TradingCalendar, default_calendar
    from .market_data.mock import MockMarketData
    from .market_data.models import AssetClass
    from .market_data.providers import MarketDataError, MarketDataProvider
    from .market_data.service import BadMarketData, MarketData

    wanted = args.symbol.strip().upper() if args.symbol else None
    instruments = [i for i in config.enabled_instruments if wanted in (None, i.symbol)]
    if not instruments:
        print(f"{wanted} isn't an enabled instrument in config.yaml.", file=sys.stderr)
        return EXIT_REFUSED
    start = args.start or config.backtest.start_date

    provider: MarketDataProvider
    calendars: Callable[[AssetClass], TradingCalendar]
    if args.mock:
        provider = MockMarketData()
        calendars = default_calendar
        print("Using made-up prices (--mock). They are marked as mock wherever they go.\n")
    else:
        keys = load_paper_keys(env)
        provider = AlpacaMarketData(
            stock_data_client(keys),
            crypto_data_client(keys),
            stock_feed=config.data.historical_stock_feed,
            adjustment=config.data.stock_price_adjustment,
        )
        stock_calendar = AlpacaCalendar(trading_client(keys))

        def calendars(asset_class: AssetClass) -> TradingCalendar:
            return EveryDay() if asset_class == "crypto" else stock_calendar

    service = MarketData(provider, cache, metadata, calendars=calendars)
    refused = failed = 0
    for instrument in instruments:
        # Up to the latest finished day for this market, unless told otherwise.
        end = (
            args.end
            or config.backtest.end_date
            or service.latest_finished_day(instrument.asset_class)
        )
        try:
            loaded = service.daily_bars(instrument.symbol, instrument.asset_class, start, end)
        except BadMarketData as exc:
            refused += 1
            print(f"[REFUSED] {instrument.symbol}: {exc.report.summary()}")
            continue
        except (MarketDataError, ValueError) as exc:
            failed += 1
            print(f"[FAIL] {instrument.symbol}: {exc}")
            continue
        series = loaded.series
        origin = (
            "reused from the cache" if loaded.from_cache else f"downloaded from {series.source}"
        )
        where = f" ({loaded.cached.path.name})" if loaded.cached else ""
        print(
            f"[ OK ] {series.symbol}: {len(series.bars):,} daily bars, {series.bars[0].day} to "
            f"{series.bars[-1].day}, {origin}; every check passed{where}"
        )
    if refused:
        print("\nRefused data is recorded in the database, and never cached or used.")
    return EXIT_OK if not (refused or failed) else EXIT_UNHEALTHY


def _data_check(cache: BarCache, metadata: MetadataStore) -> int:
    from .market_data.cache import CacheError
    from .market_data.validation import validate_bars

    files = cache.files()
    if not files:
        print("No market data is cached yet. Run: strata data fetch")
        return EXIT_OK
    problems = 0
    for path in files:
        try:
            key = cache.key_of(path)
            recorded = metadata.recorded_sha256(key)
            loaded = cache.load(key, expected_sha256=recorded)
        except CacheError as exc:
            problems += 1
            print(f"[FAIL] {path.name}: {exc}")
            continue
        if loaded is None:
            continue
        series, file = loaded
        report = validate_bars(series)
        if not report.ok:
            problems += 1
            print(f"[FAIL] {path.name}: {report.summary()}")
        elif recorded is None:
            print(
                f"[WARN] {path.name}: no record in the database; the next fetch downloads it again"
            )
        else:
            print(f"[ OK ] {path.name}: {file.bar_count:,} bars; hash matches its record")
    return EXIT_OK if not problems else EXIT_UNHEALTHY


# --- operator ----------------------------------------------------------------------------


def _operator(args: argparse.Namespace, settings: Settings, env: dict[str, str]) -> int:
    engine = engine_from_settings(settings, load_database_password(env))
    try:
        schema = check_schema(engine)
        if not schema.ok:
            print(f"Database not ready: {schema.detail}", file=sys.stderr)
            return EXIT_UNHEALTHY
        sessions = session_factory(engine)
        action = args.operator_command

        if action == "list":
            with sessions() as session:
                operators = list_operators(session)
            if not operators:
                print("No dashboard accounts yet. Create one with: strata operator create NAME")
            for operator in operators:
                state = "disabled" if operator.disabled else "active"
                last = (
                    f"{operator.last_login_at.astimezone(UTC):%Y-%m-%d %H:%M} UTC"
                    if operator.last_login_at
                    else "never"
                )
                print(f"{operator.username:<24} {state:<9} last login: {last}")
            return EXIT_OK

        username = normalise_username(args.username)
        actor = f"cli:{_system_user()}"
        password = (
            _new_password(args.password_stdin) if action in ("create", "reset-password") else ""
        )
        with sessions.begin() as session:
            if action == "create":
                create_operator(session, username, password, actor=actor)
            elif action == "reset-password":
                reset_password(session, username, password, actor=actor)
            else:
                set_disabled(session, username, action == "disable", actor=actor)
        log_event("operator_changed", f"operator {username}: {action}", actor=actor)
        print(f"Done: {action} {username}.")
        if action in ("reset-password", "disable"):
            _end_sessions(settings, username)
        return EXIT_OK
    except (OperatorError, WeakPasswordError) as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED
    finally:
        engine.dispose()


def _new_password(from_stdin: bool) -> str:
    if from_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        if not password:
            raise WeakPasswordError("No password was given on standard input.")
        return password
    first = getpass.getpass(f"New password (at least {MIN_PASSWORD_LENGTH} characters): ")
    second = getpass.getpass("Type it again: ")
    if first != second:
        raise WeakPasswordError("The two passwords didn't match. Nothing was changed.")
    return first


def _end_sessions(settings: Settings, username: str) -> None:
    # The API also refuses these sessions on its own (it checks the account on
    # every request), so this is a tidy-up rather than the only safeguard.
    client = make_redis(settings.redis_url, settings.redis_timeout_s)
    try:
        ended = SessionStore(client).end_all_for(username)
        print(f"Ended {ended} dashboard session(s).")
    except Exception:
        print("Couldn't reach Redis to end sessions; the API refuses them anyway.")
    finally:
        client.close()


def _system_user() -> str:
    try:
        return getpass.getuser()
    except Exception:
        return "unknown"


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
