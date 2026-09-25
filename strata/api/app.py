"""Building the API application.

`build_services()` connects to PostgreSQL and Redis using the STRATA_ settings
and the secrets file. `create_app()` wraps those services in a FastAPI app
that gives every request an ID, logs every request (never its headers, so a
token or session can't reach the logs), records start-up and shutdown in the
database, and answers "unavailable" (503) instead of crashing when PostgreSQL
or Redis is down.

Tests pass their own `Services`, so the API can be tested without a database.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy.exc import SQLAlchemyError

from .. import __version__
from ..auth.limits import LoginLimiter
from ..auth.sessions import SessionStore
from ..config import Config, load_config
from ..credentials import (
    live_trading_switch_on,
    load_api_token,
    load_database_password,
    read_env_file,
    secret_values,
)
from ..db.session import engine_from_settings, session_factory
from ..health import ComponentHealth, check_database, check_redis, check_schema
from ..logging_setup import log_context, log_event, register_secrets
from ..redis_client import make_redis
from ..settings import Settings
from .auth_routes import router as auth_router
from .routes import router
from .store import DatabaseStore, Store

log = logging.getLogger("strata.api")

# Accept a caller's request ID only if it is short and plain (no log injection).
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


@dataclass
class Services:
    """Everything the API needs, created once at start-up."""

    settings: Settings
    config: Config
    api_token: str | None
    live_trading_switch: bool
    health_checks: Callable[[], list[ComponentHealth]]
    store: Store
    sessions: SessionStore
    login_limiter: LoginLimiter
    close: Callable[[], None]
    started_at: datetime


def build_services(settings: Settings) -> Services:
    """Connect to PostgreSQL and Redis as the settings and secrets file say."""
    config = load_config(settings.config_file)
    env = read_env_file(settings.secrets_file)
    register_secrets(*secret_values(env))
    engine = engine_from_settings(settings, load_database_password(env))
    sessions = session_factory(engine)
    redis_client = make_redis(settings.redis_url, settings.redis_timeout_s)

    def health_checks() -> list[ComponentHealth]:
        return [check_database(engine), check_schema(engine), check_redis(redis_client)]

    def close() -> None:
        redis_client.close()
        engine.dispose()

    return Services(
        settings=settings,
        config=config,
        api_token=load_api_token(env),
        live_trading_switch=live_trading_switch_on(env),
        health_checks=health_checks,
        store=DatabaseStore(sessions, settings.component),
        sessions=SessionStore(redis_client),
        login_limiter=LoginLimiter(redis_client),
        close=close,
        started_at=datetime.now(UTC),
    )


def create_app(services: Services) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services.store.record_event("api_started", f"API {__version__} started")
        log_event("api_started", f"API {__version__} started")
        if services.api_token is None:
            log.warning("ADMIN_API_TOKEN is not set: only dashboard logins can use the API")
        try:
            yield
        finally:
            services.store.record_event("api_stopped", "API stopped")
            log_event("api_stopped", "API stopped")
            services.close()

    app = FastAPI(
        title="STRATA API",
        version=__version__,
        description="Status and control of the STRATA trading platform. Paper trading by default.",
        lifespan=lifespan,
    )
    app.state.services = services
    app.middleware("http")(_request_context)
    app.add_exception_handler(SQLAlchemyError, _unavailable("The database is unavailable."))
    app.add_exception_handler(RedisError, _unavailable("The session store (Redis) is unavailable."))
    app.include_router(router)
    app.include_router(auth_router)
    return app


def _unavailable(detail: str) -> Callable[[Request, Exception], Awaitable[Response]]:
    async def handler(request: Request, exc: Exception) -> Response:
        log_event(
            "dependency_unavailable",
            f"{request.method} {request.url.path}: {detail}",
            level=logging.ERROR,
            result=503,
            error=type(exc).__name__,
        )
        return JSONResponse(status_code=503, content={"detail": detail})

    return handler


async def _request_context(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    incoming = request.headers.get("x-request-id", "")
    request_id = incoming if _REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
    request.state.request_id = request_id
    start = perf_counter()
    with log_context(request_id=request_id):
        try:
            response = await call_next(request)
        except Exception:
            log_event(
                "http_request",
                f"{request.method} {request.url.path} failed",
                level=logging.ERROR,
                result=500,
                method=request.method,
                path=request.url.path,
            )
            raise
        duration_ms = round((perf_counter() - start) * 1000, 1)
        # Only the method and path are logged: never headers or query strings,
        # which is where tokens travel.
        log_event(
            "http_request",
            f"{request.method} {request.url.path} -> {response.status_code}",
            result=response.status_code,
            method=request.method,
            path=request.url.path,
            duration_ms=duration_ms,
        )
    response.headers["X-Request-ID"] = request_id
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
