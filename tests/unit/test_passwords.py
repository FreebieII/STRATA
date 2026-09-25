"""Tests for operator password hashing (strata/auth/passwords.py)."""

from __future__ import annotations

import pytest

from strata.auth.passwords import (
    MIN_PASSWORD_LENGTH,
    WeakPasswordError,
    check_password_rules,
    hash_password,
    verify_password,
)

GOOD = "correct-horse-battery-staple"


@pytest.fixture(scope="module")
def stored() -> str:
    return hash_password(GOOD)  # slow on purpose, so hash once


def test_the_right_password_matches(stored):
    assert verify_password(GOOD, stored)


@pytest.mark.parametrize("attempt", ["", "correct-horse-battery-stapl", GOOD.upper(), GOOD + " "])
def test_anything_else_does_not(stored, attempt):
    assert not verify_password(attempt, stored)


def test_the_password_itself_is_never_stored(stored):
    assert GOOD not in stored
    assert stored.startswith("scrypt$65536$8$2$")


def test_each_hash_gets_its_own_salt(stored):
    assert hash_password(GOOD) != stored


@pytest.mark.parametrize("damaged", ["", "plain", "md5$abc", "scrypt$1$2$3", "scrypt$x$8$2$aa$bb"])
def test_a_damaged_hash_never_matches(damaged):
    assert not verify_password(GOOD, damaged)


def test_short_passwords_are_refused():
    with pytest.raises(WeakPasswordError, match=f"at least {MIN_PASSWORD_LENGTH}"):
        check_password_rules("a" * 3 + "bcd12")


def test_a_password_containing_the_username_is_refused():
    with pytest.raises(WeakPasswordError, match="username"):
        check_password_rules("my-name-is-alice-ok", "alice")


def test_a_password_of_one_repeated_character_is_refused():
    with pytest.raises(WeakPasswordError, match="different characters"):
        check_password_rules("aaaaaaaaaaaaaaaa")


def test_a_reasonable_password_passes():
    check_password_rules(GOOD, "alice")
