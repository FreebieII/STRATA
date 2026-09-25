"""The shapes of API responses (they also document the API at /docs)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


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
