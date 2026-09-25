"""Slowing down password guessing.

Failed logins are counted in Redis per username and per network address.
After MAX_FAILURES failures inside WINDOW_S, further attempts for that
username or from that address are refused until the window has passed, even
with the right password. A successful login clears the username's count.

Someone on your network could use this to lock you out of the dashboard for
15 minutes by guessing wrong on purpose. The API token and the `strata`
command on the machine keep working, and every failure is recorded.
"""

from __future__ import annotations

from typing import Any

MAX_FAILURES = 5
WINDOW_S = 15 * 60
_USER = "strata:login-failures:user:"
_ADDRESS = "strata:login-failures:address:"


class LoginLimiter:
    def __init__(self, redis: Any, max_failures: int = MAX_FAILURES, window_s: int = WINDOW_S):
        self._redis = redis
        self._max = max_failures
        self._window_s = window_s

    def seconds_blocked(self, username: str, address: str) -> int:
        """0 if a login attempt may go ahead, else how long until it may."""
        waits = []
        for key in (_USER + username, _ADDRESS + address):
            failures = int(self._redis.get(key) or 0)
            if failures >= self._max:
                waits.append(max(int(self._redis.ttl(key)), 1))
        return max(waits, default=0)

    def record_failure(self, username: str, address: str) -> None:
        pipe = self._redis.pipeline()
        for key in (_USER + username, _ADDRESS + address):
            pipe.incr(key)
            pipe.expire(key, self._window_s, nx=True)  # the window starts at the first failure
        pipe.execute()

    def record_success(self, username: str) -> None:
        self._redis.delete(_USER + username)
