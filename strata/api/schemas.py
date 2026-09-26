"""The shapes of API responses (they also document the API at /docs)."""

from __future__ import annotations

from datetime import date, datetime
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


class MACrossoverSummary(BaseModel):
    fast_period: int
    slow_period: int


class RSIReversionSummary(BaseModel):
    rsi_period: int
    buy_below: float
    sell_above: float


class StrategiesSummary(BaseModel):
    ma_crossover: MACrossoverSummary
    rsi_reversion: RSIReversionSummary


class CostSummary(BaseModel):
    # Percentages of the trade's value, each way; the fee in dollars per sale.
    fee_pct: float
    fee_per_sell_usd: float
    slippage_pct: float


class CostsSummary(BaseModel):
    stock: CostSummary
    crypto: CostSummary


class BacktestSummary(BaseModel):
    start_date: date
    # Results from this date on are out-of-sample: never used to choose settings.
    test_start_date: date
    # None means "up to the latest data".
    end_date: date | None


class TradingSummary(BaseModel):
    # True only if .env says LIVE_TRADING=true. Live trading ALSO needs the
    # --live flag and a typed phrase, so true here does not mean live.
    live_trading_switch: bool
    default_mode: Literal["paper"]
    # The trading day's time zone (config.yaml): daily limits reset here.
    timezone: str
    instruments: list[InstrumentSummary]
    risk_limits: RiskLimitsSummary
    strategies: StrategiesSummary
    costs: CostsSummary
    backtest: BacktestSummary
    stock_data_feed: Literal["sip", "iex"]


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


# --- charts -----------------------------------------------------------------------


class EventDay(BaseModel):
    """How many events of each severity happened on one day (in the asked time zone)."""

    day: date
    debug: int = 0
    info: int = 0
    warning: int = 0
    error: int = 0
    critical: int = 0


class NameCount(BaseModel):
    name: str
    count: int


class EventStats(BaseModel):
    days: int
    tz: str
    # The start of the first day counted.
    since: datetime
    # One entry per day, oldest first, including days with nothing.
    buckets: list[EventDay]
    # The most frequent event types in the period, most frequent first.
    types: list[NameCount]
    total: int


class AuditDay(BaseModel):
    day: date
    # action -> how many times (only actions that happened that day)
    counts: dict[str, int]
    total: int


class AuditStats(BaseModel):
    days: int
    tz: str
    since: datetime
    buckets: list[AuditDay]
    # Every action in the period, most frequent first.
    actions: list[NameCount]
    total: int


class HealthPoint(BaseModel):
    start: datetime
    samples: int
    failed: int
    latency_avg_ms: float | None
    latency_max_ms: float | None


class HealthSeries(BaseModel):
    name: str
    points: list[HealthPoint]
    # Share of readings in the window that passed; None with no readings.
    availability_pct: float | None


class HealthHistoryOut(BaseModel):
    window: Literal["1h", "6h", "24h"]
    bucket_s: int
    sample_every_s: int
    # When this API process started recording (the history is kept in memory).
    recording_since: datetime | None
    series: list[HealthSeries]


# --- logging in -------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=1024)


class Identity(BaseModel):
    """Who is calling: an operator with a dashboard session, or a script with the token."""

    via: Literal["session", "token"]
    username: str | None
    session_expires_at: datetime | None
