"""Tests for dashboard sessions and login rate limits, with an in-memory Redis."""

from __future__ import annotations

import pytest

from strata.auth.limits import MAX_FAILURES, WINDOW_S, LoginLimiter
from strata.auth.sessions import SESSION_TTL_S, SessionStore
from tests.fakes import FakeRedis


@pytest.fixture
def redis() -> FakeRedis:
    return FakeRedis()


# --- sessions ---------------------------------------------------------------------


def test_a_new_session_can_be_found(redis):
    store = SessionStore(redis)
    session_id = store.create("alice")
    info = store.get(session_id)
    assert info is not None
    assert info.username == "alice"


def test_session_ids_are_long_and_unique(redis):
    store = SessionStore(redis)
    ids = {store.create("alice") for _ in range(20)}
    assert len(ids) == 20
    assert all(len(session_id) >= 40 for session_id in ids)


def test_redis_holds_only_a_hash_of_the_id(redis):
    session_id = SessionStore(redis).create("alice")
    stored = " ".join(f"{key} {value}" for key, value in redis.data.items())
    assert session_id not in stored


def test_a_session_expires(redis):
    store = SessionStore(redis)
    session_id = store.create("alice")
    redis.advance(SESSION_TTL_S + 1)
    assert store.get(session_id) is None


def test_ending_a_session(redis):
    store = SessionStore(redis)
    session_id = store.create("alice")
    store.end(session_id)
    assert store.get(session_id) is None


def test_ending_all_sessions_of_one_operator(redis):
    store = SessionStore(redis)
    alice = [store.create("alice") for _ in range(3)]
    bob = store.create("bob")
    assert store.end_all_for("alice") == 3
    assert all(store.get(session_id) is None for session_id in alice)
    assert store.get(bob) is not None


@pytest.mark.parametrize("bad", ["", "x" * 500, "not-a-real-session"])
def test_unknown_or_silly_ids_are_not_sessions(redis, bad):
    assert SessionStore(redis).get(bad) is None


def test_a_damaged_record_is_not_a_session(redis):
    store = SessionStore(redis)
    session_id = store.create("alice")
    for key in list(redis.data):
        if key.startswith("strata:session:"):
            redis.data[key] = "{not json"
    assert store.get(session_id) is None


# --- login limits ------------------------------------------------------------------


def _fail(limiter: LoginLimiter, times: int, username="alice", address="192.168.1.20") -> None:
    for _ in range(times):
        limiter.record_failure(username, address)


def test_logins_are_allowed_below_the_limit(redis):
    limiter = LoginLimiter(redis)
    _fail(limiter, MAX_FAILURES - 1)
    assert limiter.seconds_blocked("alice", "192.168.1.20") == 0


def test_too_many_failures_block_that_username(redis):
    limiter = LoginLimiter(redis)
    _fail(limiter, MAX_FAILURES)
    assert 0 < limiter.seconds_blocked("alice", "10.0.0.9") <= WINDOW_S


def test_too_many_failures_block_that_address_for_any_username(redis):
    limiter = LoginLimiter(redis)
    for name in ("a1", "a2", "a3", "a4", "a5"):
        limiter.record_failure(name, "192.168.1.66")
    assert limiter.seconds_blocked("alice", "192.168.1.66") > 0
    assert limiter.seconds_blocked("alice", "192.168.1.20") == 0


def test_the_block_lifts_after_the_window(redis):
    limiter = LoginLimiter(redis)
    _fail(limiter, MAX_FAILURES)
    redis.advance(WINDOW_S + 1)
    assert limiter.seconds_blocked("alice", "192.168.1.20") == 0


def test_the_window_starts_at_the_first_failure(redis):
    limiter = LoginLimiter(redis)
    _fail(limiter, 1)
    redis.advance(WINDOW_S - 10)
    _fail(limiter, MAX_FAILURES - 1)  # later failures don't extend the window
    redis.advance(11)
    assert limiter.seconds_blocked("alice", "192.168.1.20") == 0


def test_a_successful_login_clears_the_username_count(redis):
    limiter = LoginLimiter(redis)
    _fail(limiter, MAX_FAILURES - 1)
    limiter.record_success("alice")
    _fail(limiter, 1, address="10.0.0.1")
    assert limiter.seconds_blocked("alice", "10.0.0.1") == 0
