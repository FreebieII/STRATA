"""Market data as STRATA uses it, whatever provider it came from.

Every time is timezone-aware UTC. Prices are floats: indicators and backtests
work on floats, and order prices get an exact type of their own when orders
arrive (Phase 8). A BarSeries records where its bars came from and which range
was asked for, so any result can be traced back to its data.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

AssetClass = Literal["stock", "crypto"]
# Daily bars drive the strategies; hourly bars are for closer looks.
Timeframe = Literal["1Day", "1Hour"]
TIMEFRAMES: tuple[Timeframe, ...] = ("1Day", "1Hour")


def _utc(moment: datetime, what: str) -> datetime:
    if moment.tzinfo is None:
        raise ValueError(f"{what} must have a time zone (got {moment.isoformat()})")
    return moment.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class Bar:
    """One bar: the opening moment, open/high/low/close, and the volume traded."""

    start: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    trade_count: int | None = None
    vwap: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "start", _utc(self.start, "a bar's start"))

    @property
    def day(self) -> date:
        """The trading day, for daily bars: the UTC date of the bar's start.

        Alpaca stamps a stock's daily bar at midnight New York time (04:00 or
        05:00 UTC) and a crypto daily bar at midnight UTC; either way the UTC
        date is the day the bar is for.
        """
        return self.start.date()


@dataclass(frozen=True, slots=True)
class BarSeries:
    symbol: str
    asset_class: AssetClass
    timeframe: Timeframe
    bars: tuple[Bar, ...]
    # The range asked for, both days included.
    start: date
    end: date
    # Where the bars came from: "alpaca" or "mock".
    source: str
    # Stocks: the feed ("sip" or "iex") and the price adjustment ("all" means
    # adjusted for splits and dividends). Crypto has neither: "none".
    feed: str
    adjustment: str

    @property
    def closes(self) -> list[float]:
        return [bar.close for bar in self.bars]

    @property
    def days(self) -> list[date]:
        return [bar.day for bar in self.bars]


@dataclass(frozen=True, slots=True)
class Quote:
    """The best bid and ask at one moment."""

    symbol: str
    time: datetime
    bid: float
    bid_size: float
    ask: float
    ask_size: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "time", _utc(self.time, "a quote's time"))

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2


@dataclass(frozen=True, slots=True)
class Trade:
    """One trade: its time, price and size."""

    symbol: str
    time: datetime
    price: float
    size: float

    def __post_init__(self) -> None:
        object.__setattr__(self, "time", _utc(self.time, "a trade's time"))


@dataclass(frozen=True, slots=True)
class Level:
    price: float
    size: float


@dataclass(frozen=True, slots=True)
class OrderBook:
    """Orders waiting to trade: bids best (highest) first, asks best (lowest) first.

    Only crypto has one at Alpaca; for stocks there is only the best bid and ask
    (a Quote)."""

    symbol: str
    time: datetime
    bids: tuple[Level, ...]
    asks: tuple[Level, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "time", _utc(self.time, "an order book's time"))
        object.__setattr__(self, "bids", tuple(sorted(self.bids, key=lambda lv: -lv.price)))
        object.__setattr__(self, "asks", tuple(sorted(self.asks, key=lambda lv: lv.price)))
