"""market_data_metadata: the record of every download of prices.

MarketData writes a row for every download, the refused ones included, and
reads back the SHA-256 recorded for a cached file, so a file changed on disk
is caught even if its description beside it was changed too. Each download
also leaves a system event (market_data_fetched or market_data_refused), which
the dashboard's Events page shows.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import MarketDataMetadata
from ..db.records import record_system_event
from .cache import CachedFile, CacheKey
from .models import BarSeries
from .validation import ValidationReport


class MetadataStore(Protocol):
    def recorded_sha256(self, key: CacheKey) -> str | None:
        """The hash recorded for this cached series, if any."""
        ...

    def record(
        self,
        series: BarSeries,
        report: ValidationReport,
        cached: CachedFile | None,
        fetched_at: datetime,
    ) -> None: ...


class DatabaseMetadataStore:
    def __init__(self, sessions: Callable[[], Session], *, component: str = "market_data") -> None:
        self._sessions = sessions
        self._component = component

    def recorded_sha256(self, key: CacheKey) -> str | None:
        with self._sessions() as session:
            return session.scalars(
                select(MarketDataMetadata.sha256)
                .where(
                    MarketDataMetadata.file_name == f"{key.stem}.csv",
                    MarketDataMetadata.valid.is_(True),
                )
                .order_by(MarketDataMetadata.id.desc())
                .limit(1)
            ).first()

    def record(
        self,
        series: BarSeries,
        report: ValidationReport,
        cached: CachedFile | None,
        fetched_at: datetime,
    ) -> None:
        bars = series.bars
        with self._sessions() as session:
            session.add(
                MarketDataMetadata(
                    fetched_at=fetched_at,
                    provider=series.source,
                    symbol=series.symbol,
                    asset_class=series.asset_class,
                    timeframe=series.timeframe,
                    feed=series.feed,
                    adjustment=series.adjustment,
                    range_start=series.start,
                    range_end=series.end,
                    bar_count=len(bars),
                    first_bar_at=bars[0].start if bars else None,
                    last_bar_at=bars[-1].start if bars else None,
                    valid=report.ok,
                    issues=[issue.as_dict() for issue in report.issues[:200]],
                    file_name=cached.path.name if cached else None,
                    sha256=cached.sha256 if cached else None,
                )
            )
            what = (
                f"{series.symbol} {series.timeframe} bars from {series.start} to {series.end} "
                f"({series.source})"
            )
            record_system_event(
                session,
                component=self._component,
                event_type="market_data_fetched" if report.ok else "market_data_refused",
                severity="info" if report.ok else "warning",
                message=f"{what}: {report.summary()}",
                details={
                    "symbol": series.symbol,
                    "provider": series.source,
                    "bars": len(bars),
                    "issues": len(report.issues),
                    "file": cached.path.name if cached else None,
                },
            )
            session.commit()
