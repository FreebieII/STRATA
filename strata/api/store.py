"""The API's access to PostgreSQL, behind one small interface.

Routes and the login check only talk to a `Store`. `DatabaseStore` is the real
one; tests use an in-memory stand-in with the same methods.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import Select, desc, func, select
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session, sessionmaker

from ..auth.operators import authenticate, get_operator
from ..db.models import AuditLog, SystemEvent
from ..db.records import record_audit, record_system_event
from . import stats
from .schemas import AuditEntryOut, AuditStats, EventStats, SystemEventOut

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
        since: datetime | None = None,
    ) -> list[SystemEventOut]: ...

    def recent_audit(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        action: str | None = None,
        since: datetime | None = None,
    ) -> list[AuditEntryOut]: ...

    def event_stats(self, *, days: int, tz: str, event_type: str | None = None) -> EventStats: ...

    def audit_stats(self, *, days: int, tz: str, action: str | None = None) -> AuditStats: ...


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
        since: datetime | None = None,
    ) -> list[SystemEventOut]:
        query = select(SystemEvent).order_by(SystemEvent.id.desc()).limit(limit)
        if before_id is not None:
            query = query.where(SystemEvent.id < before_id)
        if severity is not None:
            query = query.where(SystemEvent.severity == severity)
        if event_type is not None:
            query = query.where(SystemEvent.event_type == event_type)
        if since is not None:
            query = query.where(SystemEvent.occurred_at >= since)
        with self._sessions() as session:
            return [SystemEventOut.model_validate(row) for row in session.scalars(query)]

    def recent_audit(
        self,
        *,
        limit: int,
        before_id: int | None = None,
        action: str | None = None,
        since: datetime | None = None,
    ) -> list[AuditEntryOut]:
        query = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
        if before_id is not None:
            query = query.where(AuditLog.id < before_id)
        if action is not None:
            query = query.where(AuditLog.action == action)
        if since is not None:
            query = query.where(AuditLog.occurred_at >= since)
        with self._sessions() as session:
            return [AuditEntryOut.model_validate(row) for row in session.scalars(query)]

    def event_stats(self, *, days: int, tz: str, event_type: str | None = None) -> EventStats:
        since, day_list = stats.period(days, tz)
        # The day is worked out in a subquery, so the time zone is sent once,
        # as a parameter, and PostgreSQL can group by it.
        where = [SystemEvent.occurred_at >= since]
        if event_type is not None:
            where.append(SystemEvent.event_type == event_type)
        rows = (
            select(
                func.date_trunc("day", SystemEvent.occurred_at, tz).label("day"),
                SystemEvent.severity.label("severity"),
            )
            .where(*where)
            .subquery()
        )
        counts = select(rows.c.day, rows.c.severity, func.count()).group_by(
            rows.c.day, rows.c.severity
        )
        n = func.count().label("n")
        types = (
            select(SystemEvent.event_type, n)
            .where(*where)
            .group_by(SystemEvent.event_type)
            .order_by(desc(n), SystemEvent.event_type)
            .limit(stats.TOP_TYPES)
        )
        count_rows = self._counted(counts)
        with self._sessions() as session:
            type_rows = [(name, int(total)) for name, total in session.execute(types)]
        return stats.event_stats(
            days=days,
            tz=tz,
            since=since,
            day_list=day_list,
            counts=((stats.local_day(day, tz), severity, n) for day, severity, n in count_rows),
            types=type_rows,
        )

    def audit_stats(self, *, days: int, tz: str, action: str | None = None) -> AuditStats:
        since, day_list = stats.period(days, tz)
        where = [AuditLog.occurred_at >= since]
        if action is not None:
            where.append(AuditLog.action == action)
        rows = (
            select(
                func.date_trunc("day", AuditLog.occurred_at, tz).label("day"),
                AuditLog.action.label("action"),
            )
            .where(*where)
            .subquery()
        )
        counts = select(rows.c.day, rows.c.action, func.count()).group_by(rows.c.day, rows.c.action)
        return stats.audit_stats(
            days=days,
            tz=tz,
            since=since,
            day_list=day_list,
            counts=((stats.local_day(day, tz), name, n) for day, name, n in self._counted(counts)),
        )

    def _counted(self, query: Select[Any, Any, Any]) -> list[tuple[datetime, str, int]]:
        try:
            with self._sessions() as session:
                return [(day, name, int(n)) for day, name, n in session.execute(query)]
        except DataError as exc:
            # PostgreSQL didn't know the time zone (it was checked against
            # Python's list first, so this means the two lists differ).
            raise ValueError("PostgreSQL doesn't know this time zone") from exc
