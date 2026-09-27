"""MarketData: the one way into prices.

    daily_bars(symbol, asset_class, start, end)

reuses the cached copy if its hash checks out and it still passes the checks;
otherwise it fetches from the provider, checks the bars (validation.py), and
refuses them with BadMarketData if anything is wrong. Good data is cached and
recorded; refused data is recorded, never cached, and never handed out.

Only finished days are served: `end` must be no later than the latest
finished day (calendars.latest_finished_day), and a bar that hasn't finished
is a problem, so nothing still changing is ever cached.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime

from ..logging_setup import log_event
from .cache import BarCache, CachedFile, CacheError, CacheKey
from .calendars import TradingCalendar, default_calendar, latest_finished_day
from .models import AssetClass, BarSeries
from .providers import MarketDataError, MarketDataProvider
from .records import MetadataStore
from .validation import ValidationReport, validate_bars

log = logging.getLogger("strata.market_data")


class BadMarketData(Exception):
    """The data failed its checks and was refused."""

    def __init__(self, series: BarSeries, report: ValidationReport) -> None:
        self.series = series
        self.report = report
        super().__init__(
            f"Refused {series.symbol} bars from {series.start} to {series.end}: {report.summary()}"
        )


@dataclass(frozen=True, slots=True)
class Loaded:
    series: BarSeries
    report: ValidationReport
    from_cache: bool
    cached: CachedFile | None


class MarketData:
    def __init__(
        self,
        provider: MarketDataProvider,
        cache: BarCache,
        metadata: MetadataStore | None,
        *,
        calendars: Callable[[AssetClass], TradingCalendar] = default_calendar,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._provider = provider
        self._cache = cache
        self._metadata = metadata
        self._calendars = calendars
        self._clock = clock

    def latest_finished_day(self, asset_class: AssetClass) -> date:
        """The most recent day that can be asked for: its bar has finished."""
        return latest_finished_day(asset_class, self._clock())

    def daily_bars(self, symbol: str, asset_class: AssetClass, start: date, end: date) -> Loaded:
        now = self._clock()
        if start > end:
            raise ValueError(f"start {start} is after end {end}")
        latest = latest_finished_day(asset_class, now)
        if end > latest:
            raise ValueError(
                f"{end} hasn't finished yet: only finished days are served, and the latest "
                f"finished {asset_class} day is {latest}"
            )
        feed, adjustment = self._provider.feed_and_adjustment(asset_class)
        key = CacheKey(
            self._provider.name, symbol, asset_class, "1Day", feed, adjustment, start, end
        )
        calendar = self._calendars(asset_class)

        hit = self._from_cache(key)
        if hit is not None:
            cached, file = hit
            report = validate_bars(cached, calendar, now=now)
            if report.ok:
                return Loaded(cached, report, True, file)
            log.warning(
                "cached %s no longer passes the checks (%s); fetching again",
                key.stem,
                report.summary(),
            )

        try:
            series = self._provider.bars(symbol, asset_class, "1Day", start, end)
        except MarketDataError as exc:
            log_event(
                "market_data_failed",
                f"Couldn't fetch {symbol} daily bars from {start} to {end}: {exc}",
                level=logging.WARNING,
            )
            raise
        report = validate_bars(series, calendar, now=now)
        fetched_at = self._clock()
        if not report.ok:
            if self._metadata is not None:
                self._metadata.record(series, report, None, fetched_at)
            log_event(
                "market_data_refused",
                f"Refused {symbol} daily bars from {start} to {end}: {report.summary()}",
                level=logging.WARNING,
            )
            raise BadMarketData(series, report)
        saved = self._cache.save(series, fetched_at=fetched_at)
        if self._metadata is not None:
            self._metadata.record(series, report, saved, fetched_at)
        log_event(
            "market_data_fetched", f"{symbol}: {report.summary()}, saved as {saved.path.name}"
        )
        return Loaded(series, report, False, saved)

    def _from_cache(self, key: CacheKey) -> tuple[BarSeries, CachedFile] | None:
        expected = None
        if self._metadata is not None:
            expected = self._metadata.recorded_sha256(key)
            if expected is None:
                # A file the database has no record of (it was reset, say) isn't
                # trusted: fetch it again, which records it.
                return None
        try:
            return self._cache.load(key, expected_sha256=expected)
        except CacheError as exc:
            log.warning("cached %s refused: %s; fetching again", key.stem, exc)
            return None
