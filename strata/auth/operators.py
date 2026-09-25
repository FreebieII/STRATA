"""Operator accounts: the people who may log in to the dashboard.

Accounts are created and managed with `strata operator ...` on the machine
itself; there is deliberately no way to create one over the network. Every
change is written to the append-only audit log.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import USERNAME_PATTERN, Operator
from ..db.records import record_audit
from .passwords import burn_time_like_a_real_check, check_password_rules, hash_password
from .passwords import verify_password as _verify

_USERNAME = re.compile(USERNAME_PATTERN)


class OperatorError(Exception):
    """An operator account can't be created or changed as asked."""


def normalise_username(username: str) -> str:
    name = username.strip().lower()
    if not _USERNAME.fullmatch(name):
        raise OperatorError(
            "Usernames are 3 to 64 characters: lowercase letters, digits, '.', '-' or '_', "
            "starting with a letter or digit."
        )
    return name


def get_operator(session: Session, username: str) -> Operator | None:
    return session.scalar(select(Operator).where(Operator.username == username))


def list_operators(session: Session) -> list[Operator]:
    return list(session.scalars(select(Operator).order_by(Operator.username)))


def create_operator(session: Session, username: str, password: str, *, actor: str) -> Operator:
    name = normalise_username(username)
    check_password_rules(password, name)
    if get_operator(session, name) is not None:
        raise OperatorError(f"An operator called {name!r} already exists.")
    operator = Operator(
        username=name,
        password_hash=hash_password(password),
        password_changed_at=datetime.now(UTC),
    )
    session.add(operator)
    session.flush()
    record_audit(
        session, actor=actor, action="operator_created", target_type="operator", target_id=name
    )
    return operator


def reset_password(session: Session, username: str, password: str, *, actor: str) -> Operator:
    """Set a new password. Every session started before now stops working."""
    operator = _existing(session, username)
    check_password_rules(password, operator.username)
    operator.password_hash = hash_password(password)
    operator.password_changed_at = datetime.now(UTC)
    record_audit(
        session,
        actor=actor,
        action="operator_password_reset",
        target_type="operator",
        target_id=operator.username,
    )
    return operator


def set_disabled(session: Session, username: str, disabled: bool, *, actor: str) -> Operator:
    operator = _existing(session, username)
    operator.disabled = disabled
    record_audit(
        session,
        actor=actor,
        action="operator_disabled" if disabled else "operator_enabled",
        target_type="operator",
        target_id=operator.username,
    )
    return operator


def authenticate(session: Session, username: str, password: str) -> Operator | None:
    """The operator, if the username and password are right and the account is active.

    Takes the same time whether or not the account exists or is disabled, so
    response times don't reveal which usernames are real.
    """
    try:
        name = normalise_username(username)
    except OperatorError:
        burn_time_like_a_real_check(password)
        return None
    operator = get_operator(session, name)
    if operator is None or operator.disabled:
        burn_time_like_a_real_check(password)
        return None
    if not _verify(password, operator.password_hash):
        return None
    operator.last_login_at = datetime.now(UTC)
    return operator


def _existing(session: Session, username: str) -> Operator:
    operator = get_operator(session, normalise_username(username))
    if operator is None:
        raise OperatorError(f"There is no operator called {username!r}.")
    return operator
