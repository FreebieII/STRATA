"""Redis: short-lived data only.

STRATA uses Redis for things that can be rebuilt at any time: caches,
short-lived market state, work queues and locks. It is never the permanent
record; that is PostgreSQL. docker-compose.yml runs Redis with saving to disk
switched off to keep it that way.

Every call has a time limit and at most one quick retry, so a Redis outage
shows up as an error within seconds instead of a frozen process.
"""

from __future__ import annotations

import redis
from redis.backoff import ExponentialBackoff
from redis.retry import Retry


def make_redis(url: str, timeout_s: float = 5.0) -> redis.Redis:
    return redis.Redis.from_url(
        url,
        socket_timeout=timeout_s,
        socket_connect_timeout=timeout_s,
        retry=Retry(ExponentialBackoff(cap=0.5, base=0.05), retries=1),
        health_check_interval=30,
        decode_responses=True,
    )
