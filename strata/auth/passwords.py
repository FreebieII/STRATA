"""Operator passwords, hashed with scrypt from Python's standard library.

scrypt is deliberately slow and memory-hungry, so each guess costs an
attacker as much as it costs us to check a login (about 0.7 s and 64 MiB).
The parameters follow OWASP's password-storage guidance (N=2^16, r=8, p=2).
At most two hashes run at once, so a flood of login attempts can't exhaust
the machine's memory.

Stored form:  scrypt$<N>$<r>$<p>$<salt, base64>$<hash, base64>
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
from functools import cache

N, R, P = 2**16, 8, 2
KEY_LENGTH = 32
SALT_LENGTH = 16
MIN_PASSWORD_LENGTH = 12
_MAX_MEMORY = 128 * 1024 * 1024
_hashing = threading.BoundedSemaphore(2)


class WeakPasswordError(ValueError):
    """The password doesn't meet the minimum rules."""


def check_password_rules(password: str, username: str = "") -> None:
    """Raise WeakPasswordError explaining what's wrong, if anything."""
    problems = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"it must be at least {MIN_PASSWORD_LENGTH} characters long")
    if username and username.lower() in password.lower():
        problems.append("it must not contain the username")
    if password and len(set(password)) < 4:
        problems.append("it must use more than a few different characters")
    if problems:
        raise WeakPasswordError("Password refused: " + "; ".join(problems) + ".")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_LENGTH)
    digest = _scrypt(password, salt, N, R, P)
    return "$".join(["scrypt", str(N), str(R), str(P), _b64(salt), _b64(digest)])


def verify_password(password: str, stored: str) -> bool:
    """True if `password` matches the stored hash. Malformed hashes never match."""
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = _scrypt(password, _unb64(salt), int(n), int(r), int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, _unb64(expected))


def burn_time_like_a_real_check(password: str) -> None:
    """Spend the same effort as verify_password when there is no account to check,
    so response times don't reveal which usernames exist."""
    verify_password(password, _dummy_hash())


@cache
def _dummy_hash() -> str:
    return hash_password(secrets.token_urlsafe(24))


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    with _hashing:
        return hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            maxmem=_MAX_MEMORY,
            dklen=KEY_LENGTH,
        )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
