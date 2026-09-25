"""API endpoints.

GET /health          public   the process is running (for Docker)
GET /health/ready    public   database, schema and Redis all OK? (names
                              and yes/no only; details need the token)
GET /system/status   token    versions, uptime, trading settings, full checks
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Request, Response, status

from ..version import code_version
from .auth import require_operator
from .schemas import (
    CheckDetail,
    Health,
    InstrumentSummary,
    Readiness,
    ReadinessCheck,
    RiskLimitsSummary,
    SystemStatus,
    TradingSummary,
)

if TYPE_CHECKING:
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
    config = services.config
    risk = config.risk
    version = code_version(services.settings.git_commit)
    return SystemStatus(
        status="ok" if all(check.ok for check in checks) else "unavailable",
        version=version["version"] or "unknown",
        git_commit=version["git_commit"],
        component=services.settings.component,
        started_at=services.started_at,
        uptime_s=round((datetime.now(UTC) - services.started_at).total_seconds(), 1),
        trading=TradingSummary(
            live_trading_switch=services.live_trading_switch,
            default_mode="paper",
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
        ),
        checks=[CheckDetail(**check.as_dict()) for check in checks],
    )
