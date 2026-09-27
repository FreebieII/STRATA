"""MarketData: fetch or reuse, check, record, and refuse bad data."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from strata.market_data.cache import BarCache, CacheKey
from strata.market_data.calendars import Weekdays, default_calendar
from strata.market_data.mock import MockMarketData
from strata.market_data.providers import MarketDataError
from strata.market_data.service import BadMarketData, MarketData

NOW = datetime(2024, 7, 2, 12, 0, tzinfo=UTC)
START, END = date(2024, 1, 2), date(2024, 6, 28)


class CountingMock(MockMarketData):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.calls = 0

    def bars(self, *args, **kwargs):
        self.calls += 1
        return super().bars(*args, **kwargs)


class MemoryMetadata:
    """market_data_metadata, in memory."""

    def __init__(self):
        self.rows: list[dict] = []

    def recorded_sha256(self, key: CacheKey) -> str | None:
        for row in reversed(self.rows):
            if row["valid"] and row["file"] == f"{key.stem}.csv":
                return row["sha256"]
        return None

    def record(self, series, report, cached, fetched_at):
        self.rows.append(
            {
                "symbol": series.symbol,
                "valid": report.ok,
                "issues": [i.kind for i in report.issues],
                "file": cached.path.name if cached else None,
                "sha256": cached.sha256 if cached else None,
                "fetched_at": fetched_at,
            }
        )


def service(tmp_path, provider=None, metadata=None):
    provider = provider or CountingMock()
    metadata = metadata if metadata is not None else MemoryMetadata()
    return (
        MarketData(
            provider, BarCache(tmp_path), metadata, calendars=default_calendar, clock=lambda: NOW
        ),
        provider,
        metadata,
    )


def test_good_data_is_checked_cached_recorded_and_then_reused(tmp_path):
    market, provider, metadata = service(tmp_path)
    first = market.daily_bars("SPY", "stock", START, END)
    assert not first.from_cache and first.report.ok
    assert first.cached is not None and first.cached.path.is_file()
    assert metadata.rows == [
        {
            "symbol": "SPY",
            "valid": True,
            "issues": [],
            "file": first.cached.path.name,
            "sha256": first.cached.sha256,
            "fetched_at": NOW,
        }
    ]

    again = market.daily_bars("SPY", "stock", START, END)
    assert again.from_cache and again.series == first.series
    assert again.cached.sha256 == first.cached.sha256
    assert provider.calls == 1  # not downloaded again
    assert len(metadata.rows) == 1


def test_bad_data_is_refused_recorded_and_never_cached(tmp_path):
    market, _, metadata = service(
        tmp_path, provider=CountingMock(defects={"SPY": ["gap", "bad_price"]})
    )
    with pytest.raises(BadMarketData) as refused:
        market.daily_bars("SPY", "stock", START, END)
    assert {"missing_day", "bad_price"} <= {i.kind for i in refused.value.report.issues}
    assert "Refused SPY bars" in str(refused.value)
    assert metadata.rows[0]["valid"] is False and metadata.rows[0]["file"] is None
    assert list(tmp_path.iterdir()) == []


def test_a_failed_download_leaves_nothing_behind(tmp_path):
    class NoAnswer(CountingMock):
        def bars(self, *args, **kwargs):
            raise MarketDataError("Alpaca didn't answer in time")

    market, _, metadata = service(tmp_path, provider=NoAnswer())
    with pytest.raises(MarketDataError, match="didn't answer"):
        market.daily_bars("SPY", "stock", START, END)
    assert metadata.rows == []
    assert list(tmp_path.iterdir()) == []


def test_a_changed_cache_file_is_fetched_again(tmp_path):
    market, provider, _ = service(tmp_path)
    first = market.daily_bars("SPY", "stock", START, END)
    text = first.cached.path.read_text()
    # The same bytes written back (a restore from a backup, say) are still trusted.
    first.cached.path.write_text(text)
    assert market.daily_bars("SPY", "stock", START, END).from_cache
    first.cached.path.write_text(text[:-40])  # damaged
    again = market.daily_bars("SPY", "stock", START, END)
    assert not again.from_cache and provider.calls == 2
    assert again.series == first.series


def test_a_cache_file_the_database_has_no_record_of_is_not_trusted(tmp_path):
    market, provider, _ = service(tmp_path)
    market.daily_bars("SPY", "stock", START, END)
    # A new, empty database: the file on disk has no record, so it is fetched
    # (and recorded) again.
    fresh = MemoryMetadata()
    market2 = MarketData(
        provider, BarCache(tmp_path), fresh, calendars=default_calendar, clock=lambda: NOW
    )
    again = market2.daily_bars("SPY", "stock", START, END)
    assert not again.from_cache and provider.calls == 2
    assert fresh.rows and fresh.rows[0]["valid"]


def test_only_finished_days_are_served(tmp_path):
    market, _, _ = service(tmp_path)
    # 12:00 UTC on 2 July: 1 July has finished in New York and in Chicago.
    assert market.latest_finished_day("stock") == date(2024, 7, 1)
    assert market.latest_finished_day("crypto") == date(2024, 7, 1)
    assert market.daily_bars("SPY", "stock", START, date(2024, 7, 1)).report.ok
    with pytest.raises(ValueError, match="only finished days"):
        market.daily_bars("SPY", "stock", START, NOW.date())
    with pytest.raises(ValueError, match="after end"):
        market.daily_bars("SPY", "stock", END, START)


def test_missing_trading_days_are_judged_by_the_market_calendar(tmp_path):
    # The mock trades every weekday; a calendar that says a weekday was a
    # holiday makes that bar "unexpected", and the data is refused.
    class HolidayOnFourthOfJuly(Weekdays):
        def sessions(self, start, end):
            return [d for d in super().sessions(start, end) if d != date(2024, 7, 4)]

    market = MarketData(
        CountingMock(),
        BarCache(tmp_path),
        MemoryMetadata(),
        calendars=lambda asset_class: HolidayOnFourthOfJuly(),
        clock=lambda: datetime(2024, 7, 10, tzinfo=UTC),
    )
    with pytest.raises(BadMarketData) as refused:
        market.daily_bars("SPY", "stock", date(2024, 7, 1), date(2024, 7, 5))
    assert [i.kind for i in refused.value.report.issues] == ["unexpected_day"]


def test_crypto_is_checked_against_every_day(tmp_path):
    market, _, _ = service(tmp_path)
    loaded = market.daily_bars("BTC/USD", "crypto", date(2024, 6, 1), date(2024, 6, 30))
    assert len(loaded.series.bars) == 30
