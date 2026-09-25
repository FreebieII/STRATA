"""Dashboard login sessions, kept in Redis.

After a successful login the browser gets a random 256-bit session ID in a
cookie that JavaScript can't read (HttpOnly), that is only sent over HTTPS
(Secure) and only to this site (SameSite=Strict). Redis stores a hash of the
ID, never the ID itself, so a copy of Redis can't be used to log in.

A session ends after SESSION_TTL_S, at logout, when its account is disabled,
or when the account's password changes (checked on every request). Losing
Redis logs everyone out, which is safe: they just log in again.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

SESSION_COOKIE = "strata_session"
SESSION_TTL_S = 8 * 60 * 60
_KEY = "strata:session:"
_USER_INDEX = "strata:sessions-of:"


@dataclass(frozen=True)
class SessionInfo:
    username: str
    created_at: datetime

    @property
    def expires_at(self) -> datetime:
        return self.created_at + timedelta(seconds=SESSION_TTL_S)


class SessionStore:
    """Create, look up and end sessions. `redis` is a redis.Redis client."""

    def __init__(self, redis: Any, ttl_s: int = SESSION_TTL_S) -> None:
        self._redis = redis
        self._ttl_s = ttl_s

    def create(self, username: str) -> str:
        """Start a session and return its ID (for the cookie; never stored)."""
        session_id = secrets.token_urlsafe(32)
        digest = _digest(session_id)
        record = json.dumps({"username": username, "created_at": datetime.now(UTC).isoformat()})
        pipe = self._redis.pipeline()
        pipe.set(_KEY + digest, record, ex=self._ttl_s)
        pipe.sadd(_USER_INDEX + username, digest)
        pipe.expire(_USER_INDEX + username, self._ttl_s)
        pipe.execute()
        return session_id

    def get(self, session_id: str) -> SessionInfo | None:
        if not session_id or len(session_id) > 128:
            return None
        raw = self._redis.get(_KEY + _digest(session_id))
        if raw is None:
            return None
        try:
            record = json.loads(raw)
            return SessionInfo(
                username=str(record["username"]),
                created_at=datetime.fromisoformat(record["created_at"]),
            )
        except (ValueError, KeyError, TypeError):
            return None  # a damaged record is simply not a session

    def end(self, session_id: str) -> None:
        info = self.get(session_id)
        digest = _digest(session_id)
        self._redis.delete(_KEY + digest)
        if info is not None:
            self._redis.srem(_USER_INDEX + info.username, digest)

    def end_all_for(self, username: str) -> int:
        """End every session of one operator (after disabling or a password reset)."""
        digests = self._redis.smembers(_USER_INDEX + username)
        if digests:
            self._redis.delete(*[_KEY + digest for digest in digests])
        self._redis.delete(_USER_INDEX + username)
        return len(digests)


def _digest(session_id: str) -> str:
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()
