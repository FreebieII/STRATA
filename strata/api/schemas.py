"""The shapes of API responses (they also document the API at /docs)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Health(BaseModel):
    status: Literal["ok"]


class ReadinessCheck(BaseModel):
    name: str
    ok: bool


class Readiness(BaseModel):
    status: Literal["ok", "unavailable"]
    checks: list[ReadinessCheck]


class CheckDetail(BaseModel):
    name: str
    ok: bool
    detail: str
    latency_ms: float | None


class InstrumentSummary(BaseModel):
    symbol: str
    asset_class: str
    strategy: str
    enabled: bool


class RiskLimitsSummary(BaseModel):
    MAX_CAPITAL: float
    MAX_POSITION_PCT: float
    STOP_LOSS_PCT: float
    DAILY_LOSS_LIMIT: float
    TOTAL_LOSS_LIMIT: float
    MAX_TRADES_PER_DAY: int
    max_position_value: float


class TradingSummary(BaseModel):
    # True only if .env says LIVE_TRADING=true. Live trading ALSO needs the
    # --live flag and a typed phrase, so true here does not mean live.
    live_trading_switch: bool
    default_mode: Literal["paper"]
    instruments: list[InstrumentSummary]
    risk_limits: RiskLimitsSummary


class SystemStatus(BaseModel):
    status: Literal["ok", "unavailable"]
    version: str
    git_commit: str | None
    component: str
    started_at: datetime
    uptime_s: float
    trading: TradingSummary
    checks: list[CheckDetail]


# --- the dashboard's read models --------------------------------------------------


class SystemEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: datetime
    component: str
    event_type: str
    severity: str
    message: str
    request_id: str | None
    details: dict[str, Any]


class EventPage(BaseModel):
    items: list[SystemEventOut]
    # Pass as before_id to get the next (older) page; null on the last page.
    next_before_id: int | None


class AuditEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    occurred_at: datetime
    actor: str
    action: str
    target_type: str | None
    target_id: str | None
    request_id: str | None
    details: dict[str, Any]


class AuditPage(BaseModel):
    items: list[AuditEntryOut]
    next_before_id: int | None


# --- logging in -------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class Identity(BaseModel):
    """Who is calling: an operator with a dashboard session, or a script with the token."""

    via: Literal["session", "token"]
    username: str | None
    session_expires_at: datetime | None
