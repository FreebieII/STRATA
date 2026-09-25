"""The API's access to PostgreSQL, behind one small interface.

Routes and the login check only talk to a `Store`. `DatabaseStore` is the real
one; tests use an in-memory stand-in with the same methods.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ..auth.operators import authenticate, get_operator
from ..db.models import AuditLog, SystemEvent
from ..db.records import record_audit, record_system_event
from .schemas import AuditEntryOut, SystemEventOut

log = logging.getLogger("strata.api")


class Store(Protocol):
    def record_event(
        self,
        event_type: str,
        message: str,
        *,
        severity: str = "info",
        details: Mapping[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None: ...

    def record_audit(
        self,
        *,
        actor: str,
        action: str,
        target_type: str | None = None,
        target_id: str | None = None,
        details: Mapping[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None: ...

    def authenticate(self, username: str, password: str) -> str | None: ...

    def operator_valid_since(self, username: str) -> datetime | None: ...

    def recent_events(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        severity: str | None = None,
        event_type: str | None = None,
    ) -> list[SystemEventOut]: ...

    def recent_audit(
        self, *, limit: int, before_id: int | None = None, action: str | None = None
    ) -> list[AuditEntryOut]: ...


class DatabaseStore:
    def __init__(self, sessions: sessionmaker[Session], component: str) -> None:
        self._sessions = sessions
        self._component = component

    def record_event(
        self,
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
            with self._sessions.begin() as session:
                record_system_event(
                    session,
                    component=self._component,
                    event_type=event_type,
                    message=message,
                    severity=severity,
                    details=details,
                    request_id=request_id,
                )
        except Exception:
            log.warning("could not store system event %s in the database", event_type)

    def record_audit(
        self,
        *,
        actor: str,
        action: str,
        target_type: str | None = None,
        target_id: str | None = None,
        details: Mapping[str, Any] | None = None,
        request_id: str | None = None,
    ) -> None:
        # Not best effort: if the audit trail can't be written, the action fails.
        with self._sessions.begin() as session:
            record_audit(
                session,
                actor=actor,
                action=action,
                target_type=target_type,
                target_id=target_id,
                details=details,
                request_id=request_id,
            )

    def authenticate(self, username: str, password: str) -> str | None:
        with self._sessions.begin() as session:
            operator = authenticate(session, username, password)
            return operator.username if operator is not None else None

    def operator_valid_since(self, username: str) -> datetime | None:
        """When the operator's current password was set, or None if they can't log in."""
        with self._sessions() as session:
            operator = get_operator(session, username)
            if operator is None or operator.disabled:
                return None
            return operator.password_changed_at

    def recent_events(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        severity: str | None = None,
        event_type: str | None = None,
    ) -> list[SystemEventOut]:
        query = select(SystemEvent).order_by(SystemEvent.id.desc()).limit(limit)
        if before_id is not None:
            query = query.where(SystemEvent.id < before_id)
        if severity is not None:
            query = query.where(SystemEvent.severity == severity)
        if event_type is not None:
            query = query.where(SystemEvent.event_type == event_type)
        with self._sessions() as session:
            return [SystemEventOut.model_validate(row) for row in session.scalars(query)]

    def recent_audit(
        self, *, limit: int, before_id: int | None = None, action: str | None = None
    ) -> list[AuditEntryOut]:
        query = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
        if before_id is not None:
            query = query.where(AuditLog.id < before_id)
        if action is not None:
            query = query.where(AuditLog.action == action)
        with self._sessions() as session:
            return [AuditEntryOut.model_validate(row) for row in session.scalars(query)]
