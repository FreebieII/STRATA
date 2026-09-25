"""Database tables.

Phase 1 needs two:

    system_events  what happened to the system: start-up, shutdown, failed
                   logins, health problems. Old rows may be pruned later.
    audit_logs     who did what, when, and why. Append-only: the database
                   itself refuses to change or delete a row (see the first
                   migration), so the audit trail can't be quietly edited.

Later phases add their own tables (orders, fills, positions, agent decisions,
risk decisions, experiments, ...) in their own migrations.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Identity, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

SEVERITIES = ("debug", "info", "warning", "error", "critical")
_SEVERITY_LIST = ", ".join(f"'{severity}'" for severity in SEVERITIES)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    component: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16))
    message: Mapped[str] = mapped_column(Text)
    request_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))

    __table_args__ = (CheckConstraint(f"severity IN ({_SEVERITY_LIST})", name="severity_known"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # "operator", "system", or an agent's name.
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str | None] = mapped_column(String(64))
    target_id: Mapped[str | None] = mapped_column(String(128))
    request_id: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
