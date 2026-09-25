"""Building the API application.

`build_services()` connects to PostgreSQL and Redis using the STRATA_ settings
and the secrets file. `create_app()` wraps those services in a FastAPI app
that gives every request an ID, logs every request (never its headers, so a
token can't reach the logs) and records start-up and shutdown in the database.

Tests pass their own `Services`, so the API can be tested without a database.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

from fastapi import FastAPI, Request, Response

from .. import __version__
from ..config import Config, load_config
from ..credentials import (
    live_trading_switch_on,
    load_api_token,
    load_database_password,
    read_env_file,
    secret_values,
)
from ..db.records import record_system_event
from ..db.session import engine_from_settings, session_factory
from ..health import ComponentHealth, check_database, check_redis, check_schema
from ..logging_setup import log_context, log_event, register_secrets
from ..redis_client import make_redis
from ..settings import Settings
from .routes import router

log = logging.getLogger("strata.api")

# Accept a caller's request ID only if it is short and plain (no log injection).
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")

EventRecorder = Callable[..., None]


@dataclass
class Services:
    """Everything the API needs, created once at start-up."""

    settings: Settings
    config: Config
    api_token: str | None
    live_trading_switch: bool
    health_checks: Callable[[], list[ComponentHealth]]
    record_event: EventRecorder
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

    def record_event(
        event_type: str,
        message: str,
        *,
        severity: str = "info",
        details: Mapping[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        # Best effort: the event is logged either way, so a database outage
        # must not turn into a failed request.
        try:
            with sessions.begin() as session:
                record_system_event(
                    session,
                    component=settings.component,
                    event_type=event_type,
                    message=message,
                    severity=severity,
                    details=details,
                    request_id=request_id,
                )
        except Exception:
            log.warning("could not store system event %s in the database", event_type)

    def close() -> None:
        redis_client.close()
        engine.dispose()

    return Services(
        settings=settings,
        config=config,
        api_token=load_api_token(env),
        live_trading_switch=live_trading_switch_on(env),
        health_checks=health_checks,
        record_event=record_event,
        close=close,
        started_at=datetime.now(UTC),
    )


def create_app(services: Services) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        services.record_event("api_started", f"API {__version__} started")
        log_event("api_started", f"API {__version__} started")
        if services.api_token is None:
            log.warning("ADMIN_API_TOKEN is not set: protected endpoints will refuse every request")
        try:
            yield
        finally:
            services.record_event("api_stopped", "API stopped")
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
    app.include_router(router)
    return app


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
