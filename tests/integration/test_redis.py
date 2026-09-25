"""Tests against a real Redis."""

from __future__ import annotations

import uuid

from strata.health import check_redis
from strata.redis_client import make_redis


def test_health_check_passes_for_a_working_redis(redis_client):
    result = check_redis(redis_client)
    assert result.ok
    assert result.latency_ms is not None


def test_values_expire(redis_client):
    key = f"strata:test:{uuid.uuid4().hex}"
    redis_client.set(key, "cached", ex=60)
    assert redis_client.get(key) == "cached"
    assert 0 < redis_client.ttl(key) <= 60
    redis_client.delete(key)


def test_health_check_fails_quickly_when_redis_is_unreachable():
    client = make_redis("redis://127.0.0.1:1/0", timeout_s=1)
    try:
        result = check_redis(client)
    finally:
        client.close()
    assert not result.ok
    assert "ConnectionError" in result.detail
