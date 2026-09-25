"""Fixtures for API tests with stand-in services (no database or Redis)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from strata.api.app import Services, create_app
from strata.auth.limits import LoginLimiter
from strata.auth.sessions import SessionStore
from strata.config import load_config
from strata.health import ComponentHealth
from strata.settings import Settings
from tests.fakes import FakeRedis, FakeStore
from tests.helpers import FAKE_API_TOKEN, PROJECT_ROOT

CONFIG = load_config(PROJECT_ROOT / "config.yaml")


class StandIn:
    """Builds Services whose parts are controlled by the test."""

    def __init__(self) -> None:
        self.store = FakeStore()
        self.redis = FakeRedis()
        self.closed = False
        self.redis_ok = True

    def services(self, *, token: str | None = FAKE_API_TOKEN) -> Services:
        def health_checks() -> list[ComponentHealth]:
            return [
                ComponentHealth("database", True, "reachable", 1.0),
                ComponentHealth("schema", True, "up to date (migration 0002)"),
                ComponentHealth(
                    "redis",
                    self.redis_ok,
                    "reachable"
                    if self.redis_ok
                    else "ConnectionError: Error 111 connecting to redis:6379",
                ),
            ]

        def close() -> None:
            self.closed = True

        return Services(
            settings=Settings(component="api"),
            config=CONFIG,
            api_token=token,
            live_trading_switch=False,
            health_checks=health_checks,
            store=self.store,
            sessions=SessionStore(self.redis),
            login_limiter=LoginLimiter(self.redis),
            close=close,
            started_at=datetime.now(UTC),
        )


@pytest.fixture
def stand_in() -> StandIn:
    return StandIn()


@pytest.fixture
def client(stand_in):
    """A test client over HTTPS (so Secure cookies are kept, as in a real browser)."""

    def _client(**kwargs) -> TestClient:
        return TestClient(create_app(stand_in.services(**kwargs)), base_url="https://testserver")

    return _client
