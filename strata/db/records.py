"""Writing system events and audit entries to the database.

Secrets are hidden before anything is stored, exactly as in the log files:
the database is one more place a key must never end up.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from ..logging_setup import redact
from .models import SEVERITIES, AuditLog, SystemEvent


def record_system_event(
    session: Session,
    *,
    component: str,
    event_type: str,
    message: str,
    severity: str = "info",
    details: Mapping[str, Any] | None = None,
    request_id: str | None = None,
) -> SystemEvent:
    """Add a system event to the session. The caller commits."""
    if severity not in SEVERITIES:
        raise ValueError(f"unknown severity {severity!r}; use one of {', '.join(SEVERITIES)}")
    event = SystemEvent(
        component=component,
        event_type=event_type,
        severity=severity,
        message=redact(message),
        details=_clean(details),
        request_id=request_id,
    )
    session.add(event)
    return event


def record_audit(
    session: Session,
    *,
    actor: str,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: Mapping[str, Any] | None = None,
    request_id: str | None = None,
) -> AuditLog:
    """Add an audit entry to the session. The caller commits. Entries are permanent."""
    entry = AuditLog(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=_clean(details),
        request_id=request_id,
    )
    session.add(entry)
    return entry


def _clean(details: Mapping[str, Any] | None) -> dict[str, Any]:
    """JSON-safe details (dates and the like become text) with secrets hidden."""
    if not details:
        return {}
    text = redact(json.dumps(dict(details), default=str, ensure_ascii=False))
    cleaned: dict[str, Any] = json.loads(text)
    return cleaned
