"""A deterministic provider: made-up prices that are the same every time.

It needs no keys and no network, so tests and offline work (trying the
indicators or a backtest before Alpaca keys are set up) use it. Prices follow a
random walk from a fixed seed, generated from a fixed first day, so a given day
always has the same bar whatever range is asked for. Its data is marked
source="mock" wherever it goes, so it can never be mistaken for market data.

`defects` injects known problems (for testing the checks): "duplicate",
"gap", "bad_price", "inconsistent", "spike", "out_of_order".
"""

from __future__ import annotations

import math
import random
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

from .calendars import TradingCalendar, day_start, default_calendar
from .models import AssetClass, Bar, BarSeries, Level, OrderBook, Quote, Timeframe, Trade
from .providers import MarketDataError

FIRST_DAY = date(2015, 1, 1)
START_PRICE: dict[AssetClass, float] = {"stock": 200.0, "crypto": 30_000.0}
DAILY_VOLATILITY: dict[AssetClass, float] = {"stock": 0.011, "crypto": 0.035}
DEFECTS = ("duplicate", "gap", "bad_price", "inconsistent", "spike", "out_of_order")


class MockMarketData:
    name = "mock"

    def __init__(
        self,
        seed: int = 1,
        *,
        calendar_for: Callable[[AssetClass], TradingCalendar] = default_calendar,
        defects: Mapping[str, Sequence[str]] | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.seed = seed
        self._calendar_for = calendar_for
        self._defects = {symbol: tuple(kinds) for symbol, kinds in (defects or {}).items()}
        for kinds in self._defects.values():
            unknown = set(kinds) - set(DEFECTS)
            if unknown:
                raise ValueError(f"unknown defects {sorted(unknown)}; choose from {DEFECTS}")
        self._now = now

    def _daily(self, symbol: str, asset_class: AssetClass, end: date) -> list[Bar]:
        # Made-up prices from a fixed seed: nothing here needs to be unpredictable.
        rng = random.Random(zlib.crc32(f"{self.seed}:{symbol}".encode()))  # noqa: S311
        vol = DAILY_VOLATILITY[asset_class]
        close = START_PRICE[asset_class]
        bars = []
        for day in self._calendar_for(asset_class).sessions(FIRST_DAY, end):
            open_ = close * (1 + rng.gauss(0, vol / 4))
            close = open_ * math.exp(rng.gauss(0.0002, vol))
            high = max(open_, close) * (1 + abs(rng.gauss(0, vol / 2)))
            low = min(open_, close) * (1 - abs(rng.gauss(0, vol / 2)))
            # Midnight where the day is counted, as Alpaca's bars are (calendars.py).
            start = day_start(day, asset_class)
            volume = float(
                round(rng.uniform(0.5, 1.5) * (80_000_000 if asset_class == "stock" else 20_000))
            )
            bars.append(
                Bar(start, round(open_, 4), round(high, 4), round(low, 4), round(close, 4), volume)
            )
        return bars

    def feed_and_adjustment(self, asset_class: AssetClass) -> tuple[str, str]:
        return ("mock" if asset_class == "stock" else "none", "none")

    def bars(
        self, symbol: str, asset_class: AssetClass, timeframe: Timeframe, start: date, end: date
    ) -> BarSeries:
        if timeframe != "1Day":
            raise MarketDataError("the mock provider makes daily bars only")
        if start > end:
            raise MarketDataError(f"start {start} is after end {end}")
        bars = [bar for bar in self._daily(symbol, asset_class, end) if bar.day >= start]
        bars = self._damage(bars, self._defects.get(symbol, ()))
        return BarSeries(
            symbol=symbol,
            asset_class=asset_class,
            timeframe=timeframe,
            bars=tuple(bars),
            start=start,
            end=end,
            source=self.name,
            feed=self.feed_and_adjustment(asset_class)[0],
            adjustment=self.feed_and_adjustment(asset_class)[1],
        )

    @staticmethod
    def _damage(bars: list[Bar], kinds: Sequence[str]) -> list[Bar]:
        if len(bars) < 6 or not kinds:
            return bars
        bars = list(bars)
        middle = len(bars) // 2
        for kind in kinds:
            if kind == "duplicate":
                bars.insert(middle, bars[middle])
            elif kind == "gap":
                del bars[middle + 1]
            elif kind == "bad_price":
                bars[middle + 2] = replace(bars[middle + 2], close=-1.0)
            elif kind == "inconsistent":
                bar = bars[middle - 1]
                bars[middle - 1] = replace(bar, high=bar.low * 0.99)
            elif kind == "spike":
                bar = bars[middle - 2]
                bars[middle - 2] = replace(bar, close=bar.close * 3, high=bar.close * 3)
            elif kind == "out_of_order":
                bars[1], bars[2] = bars[2], bars[1]
        return bars

    def _last(self, symbol: str, asset_class: AssetClass) -> Bar:
        today = self._now().date()
        bars = self._daily(symbol, asset_class, today)
        if not bars:
            raise MarketDataError(f"no mock prices for {symbol}")
        return bars[-1]

    def latest_quote(self, symbol: str, asset_class: AssetClass) -> Quote:
        close = self._last(symbol, asset_class).close
        half_spread = close * (0.00005 if asset_class == "stock" else 0.0002)
        return Quote(
            symbol,
            self._now(),
            round(close - half_spread, 4),
            300.0,
            round(close + half_spread, 4),
            300.0,
        )

    def latest_trade(self, symbol: str, asset_class: AssetClass) -> Trade:
        return Trade(symbol, self._now(), self._last(symbol, asset_class).close, 100.0)

    def latest_order_book(self, symbol: str, asset_class: AssetClass) -> OrderBook | None:
        if asset_class != "crypto":
            return None
        quote = self.latest_quote(symbol, asset_class)
        step = quote.ask * 0.0001
        return OrderBook(
            symbol,
            quote.time,
            bids=tuple(Level(round(quote.bid - i * step, 2), 0.5 * (i + 1)) for i in range(5)),
            asks=tuple(Level(round(quote.ask + i * step, 2), 0.5 * (i + 1)) for i in range(5)),
        )


def mock_series(
    symbol: str = "SPY",
    asset_class: AssetClass = "stock",
    days: int = 30,
    *,
    end: date | None = None,
) -> BarSeries:
    """A short, clean daily series for tests."""
    end = end or date(2024, 6, 28)
    return MockMarketData().bars(symbol, asset_class, "1Day", end - timedelta(days=days), end)
