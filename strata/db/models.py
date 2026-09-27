"""Database tables.

    system_events  what happened to the system: start-up, shutdown, failed
                   logins, health problems. Old rows may be pruned later.
    audit_logs     who did what, when, and why. Append-only: the database
                   itself refuses to change or delete a row (see the first
                   migration), so the audit trail can't be quietly edited.
    operators      the people who may log in to the dashboard. Passwords are
                   stored only as scrypt hashes.
    market_data_metadata
                   every download of prices: what, from where, which range,
                   how many bars, the cached file and its SHA-256, and whether
                   the checks passed (refused downloads are recorded too).

Later phases add their own tables (orders, fills, positions, agent decisions,
risk decisions, experiments, ...) in their own migrations.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Identity,
    Index,
    Integer,
    String,
    Text,
    false,
    func,
    text,
)
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


USERNAME_PATTERN = r"^[a-z0-9][a-z0-9._-]{2,63}$"


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    disabled: Mapped[bool] = mapped_column(Boolean, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Sessions started before this moment stop working (see strata.auth.sessions).
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint(f"username ~ '{USERNAME_PATTERN}'", name="username_format"),)


class MarketDataMetadata(Base):
    __tablename__ = "market_data_metadata"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # "alpaca" or "mock".
    provider: Mapped[str] = mapped_column(String(32))
    symbol: Mapped[str] = mapped_column(String(32))
    asset_class: Mapped[str] = mapped_column(String(16))
    timeframe: Mapped[str] = mapped_column(String(16))
    # "sip" or "iex" for stocks, "none" for crypto; adjustment "all" = splits and dividends.
    feed: Mapped[str] = mapped_column(String(16))
    adjustment: Mapped[str] = mapped_column(String(16))
    range_start: Mapped[date] = mapped_column(Date)
    range_end: Mapped[date] = mapped_column(Date)
    bar_count: Mapped[int] = mapped_column(Integer)
    first_bar_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_bar_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # False: the checks found problems and the data was refused (and not cached).
    valid: Mapped[bool] = mapped_column(Boolean)
    issues: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    # The cached file's name in the market-data cache (paths.data_dir/market) and its SHA-256.
    file_name: Mapped[str | None] = mapped_column(String(255))
    sha256: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (
        CheckConstraint("asset_class IN ('stock', 'crypto')", name="asset_class_known"),
        CheckConstraint("range_start <= range_end", name="range_in_order"),
        CheckConstraint("bar_count >= 0", name="bar_count_not_negative"),
        CheckConstraint("sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'", name="sha256_hex"),
        CheckConstraint("valid OR file_name IS NULL", name="refused_data_not_cached"),
        Index("ix_market_data_metadata_series", "symbol", "timeframe", "range_start", "range_end"),
    )
