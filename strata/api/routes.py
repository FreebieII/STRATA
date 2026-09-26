"""API endpoints.

GET /health          public   the process is running (for Docker)
GET /health/ready    public   database, schema and Redis all OK? (names
                              and yes/no only; details need the token)
GET /system/status   login    versions, uptime, trading settings, full checks
GET /system/events   login    system events, newest first, in pages
GET /system/events/stats     login    events per day by severity, top types
GET /system/health/history   login    the API's own health readings (24 h, in memory)
GET /audit           login    the audit log, newest first, in pages
GET /audit/stats     login    audit entries per day by action

"login" means a dashboard session or the API token (see auth.py).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from ..version import code_version
from . import stats
from .auth import require_operator
from .health_history import SAMPLE_EVERY_S, WINDOWS, Window
from .schemas import (
    AuditPage,
    AuditStats,
    BacktestSummary,
    CheckDetail,
    CostsSummary,
    CostSummary,
    EventPage,
    EventStats,
    Health,
    HealthHistoryOut,
    HealthPoint,
    HealthSeries,
    InstrumentSummary,
    MACrossoverSummary,
    Readiness,
    ReadinessCheck,
    RiskLimitsSummary,
    RSIReversionSummary,
    StrategiesSummary,
    SystemStatus,
    TradingSummary,
)

if TYPE_CHECKING:
    from ..config import Config
    from .app import Services

router = APIRouter()


def _services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


@router.get("/health", response_model=Health, tags=["health"])
def health() -> Health:
    """Liveness: answers as long as the process runs. Checks nothing else."""
    return Health(status="ok")


@router.get(
    "/health/ready",
    response_model=Readiness,
    tags=["health"],
    responses={503: {"model": Readiness, "description": "something isn't working"}},
)
def ready(request: Request, response: Response) -> Readiness:
    """Readiness: are the database, its schema and Redis all working?"""
    checks = _services(request).health_checks()
    ok = all(check.ok for check in checks)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Readiness(
        status="ok" if ok else "unavailable",
        checks=[ReadinessCheck(name=check.name, ok=check.ok) for check in checks],
    )


def trading_summary(config: Config, *, live_trading_switch: bool) -> TradingSummary:
    """The trading settings as the dashboard sees them. The dashboard keeps a copy
    for config.yaml as shipped (frontend/src/learn/shipped.json), which a test
    compares with this."""
    risk = config.risk
    return TradingSummary(
        live_trading_switch=live_trading_switch,
        default_mode="paper",
        timezone=config.timezone,
        instruments=[
            InstrumentSummary(
                symbol=i.symbol,
                asset_class=i.asset_class,
                strategy=i.strategy,
                enabled=i.enabled,
            )
            for i in config.instruments
        ],
        risk_limits=RiskLimitsSummary(
            MAX_CAPITAL=risk.MAX_CAPITAL,
            MAX_POSITION_PCT=risk.MAX_POSITION_PCT,
            STOP_LOSS_PCT=risk.STOP_LOSS_PCT,
            DAILY_LOSS_LIMIT=risk.DAILY_LOSS_LIMIT,
            TOTAL_LOSS_LIMIT=risk.TOTAL_LOSS_LIMIT,
            MAX_TRADES_PER_DAY=risk.MAX_TRADES_PER_DAY,
            max_position_value=risk.max_position_value,
        ),
        strategies=StrategiesSummary(
            ma_crossover=MACrossoverSummary(**config.strategies.ma_crossover.model_dump()),
            rsi_reversion=RSIReversionSummary(**config.strategies.rsi_reversion.model_dump()),
        ),
        costs=CostsSummary(
            stock=CostSummary(**config.costs.stock.model_dump()),
            crypto=CostSummary(**config.costs.crypto.model_dump()),
        ),
        backtest=BacktestSummary(
            start_date=config.backtest.start_date,
            test_start_date=config.backtest.test_start_date,
            end_date=config.backtest.end_date,
        ),
        stock_data_feed=config.data.historical_stock_feed,
    )


@router.get(
    "/system/status",
    response_model=SystemStatus,
    tags=["system"],
    dependencies=[Depends(require_operator)],
)
def system_status(request: Request) -> SystemStatus:
    """Versions, uptime, trading settings and detailed health checks."""
    services = _services(request)
    checks = services.health_checks()
    version = code_version(services.settings.git_commit)
    return SystemStatus(
        status="ok" if all(check.ok for check in checks) else "unavailable",
        version=version["version"] or "unknown",
        git_commit=version["git_commit"],
        component=services.settings.component,
        started_at=services.started_at,
        uptime_s=round((datetime.now(UTC) - services.started_at).total_seconds(), 1),
        trading=trading_summary(services.config, live_trading_switch=services.live_trading_switch),
        checks=[CheckDetail(**check.as_dict()) for check in checks],
    )


_NAME = r"^[a-z0-9_.-]{1,64}$"
_TZ = r"^[A-Za-z0-9_+\-/]{1,64}$"


def _utc(moment: datetime | None) -> datetime | None:
    """Times without a zone are taken as UTC."""
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment


def _check_timezone(tz: str) -> None:
    if not stats.valid_timezone(tz):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Unknown time zone {tz!r}."
        )


@router.get(
    "/system/events",
    response_model=EventPage,
    tags=["system"],
    dependencies=[Depends(require_operator)],
)
def system_events(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, ge=1),
    severity: Literal["debug", "info", "warning", "error", "critical"] | None = None,
    event_type: str | None = Query(None, pattern=_NAME),
    since: Annotated[
        datetime | None, Query(description="only events at or after this time")
    ] = None,
) -> EventPage:
    """System events, newest first. Pass `next_before_id` back as `before_id` for older ones."""
    rows = _services(request).store.recent_events(
        limit=limit + 1,
        before_id=before_id,
        severity=severity,
        event_type=event_type,
        since=_utc(since),
    )
    more = len(rows) > limit
    return EventPage(items=rows[:limit], next_before_id=rows[limit - 1].id if more else None)


@router.get(
    "/audit", response_model=AuditPage, tags=["system"], dependencies=[Depends(require_operator)]
)
def audit_log(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, ge=1),
    action: str | None = Query(None, pattern=_NAME),
    since: Annotated[
        datetime | None, Query(description="only entries at or after this time")
    ] = None,
) -> AuditPage:
    """The audit log, newest first. Pass `next_before_id` back as `before_id` for older ones."""
    rows = _services(request).store.recent_audit(
        limit=limit + 1, before_id=before_id, action=action, since=_utc(since)
    )
    more = len(rows) > limit
    return AuditPage(items=rows[:limit], next_before_id=rows[limit - 1].id if more else None)


@router.get(
    "/system/events/stats",
    response_model=EventStats,
    tags=["system"],
    dependencies=[Depends(require_operator)],
)
def system_event_stats(
    request: Request,
    days: int = Query(14, ge=1, le=stats.MAX_DAYS),
    tz: str = Query("UTC", pattern=_TZ, description="count days in this time zone"),
    event_type: str | None = Query(None, pattern=_NAME),
) -> EventStats:
    """How many events happened each day, by severity, and the most frequent types."""
    _check_timezone(tz)
    try:
        return _services(request).store.event_stats(days=days, tz=tz, event_type=event_type)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.get(
    "/audit/stats",
    response_model=AuditStats,
    tags=["system"],
    dependencies=[Depends(require_operator)],
)
def audit_stats(
    request: Request,
    days: int = Query(30, ge=1, le=stats.MAX_DAYS),
    tz: str = Query("UTC", pattern=_TZ, description="count days in this time zone"),
    action: str | None = Query(None, pattern=_NAME),
) -> AuditStats:
    """How many audit entries there were each day, by action."""
    _check_timezone(tz)
    try:
        return _services(request).store.audit_stats(days=days, tz=tz, action=action)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc


@router.get(
    "/system/health/history",
    response_model=HealthHistoryOut,
    tags=["system"],
    dependencies=[Depends(require_operator)],
)
def health_history(request: Request, window: Window = "1h") -> HealthHistoryOut:
    """The API's own health readings, one every 15 seconds, grouped into equal time slots.

    Kept in the API's memory for 24 hours; a restart starts afresh.
    """
    history = _services(request).health_history
    series = history.summary(window, datetime.now(UTC))
    return HealthHistoryOut(
        window=window,
        bucket_s=WINDOWS[window][1],
        sample_every_s=SAMPLE_EVERY_S,
        recording_since=history.recording_since,
        series=[
            HealthSeries(
                name=item.name,
                availability_pct=item.availability_pct,
                points=[
                    HealthPoint(
                        start=p.start,
                        samples=p.samples,
                        failed=p.failed,
                        latency_avg_ms=p.latency_avg_ms,
                        latency_max_ms=p.latency_max_ms,
                    )
                    for p in item.points
                ],
            )
            for item in series
        ],
    )
