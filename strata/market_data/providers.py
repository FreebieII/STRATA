"""The interface every source of prices provides.

A provider only fetches: it doesn't check, cache or record anything. That is
MarketData's job (service.py), so every provider's data goes through the same
checks before anything uses it.
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from .models import AssetClass, BarSeries, OrderBook, Quote, Timeframe, Trade


class MarketDataError(Exception):
    """The provider couldn't deliver: no answer, refused, or not allowed.

    The message says what happened in plain words, and what to do if the
    operator can fix it."""


class MarketDataProvider(Protocol):
    # "alpaca" or "mock": recorded with everything it delivers.
    name: str

    def feed_and_adjustment(self, asset_class: AssetClass) -> tuple[str, str]:
        """What its bars for this asset class will say they are (see BarSeries)."""
        ...

    def bars(
        self, symbol: str, asset_class: AssetClass, timeframe: Timeframe, start: date, end: date
    ) -> BarSeries:
        """Bars from `start` to `end`, both days included."""
        ...

    def latest_quote(self, symbol: str, asset_class: AssetClass) -> Quote: ...

    def latest_trade(self, symbol: str, asset_class: AssetClass) -> Trade: ...

    def latest_order_book(self, symbol: str, asset_class: AssetClass) -> OrderBook | None:
        """The order book, where the provider has one (crypto at Alpaca); None otherwise."""
        ...
