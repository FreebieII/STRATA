"""Prices from Alpaca: read-only market data, fetched with the paper keys.

Stock bars come from the feed in config.yaml (data.historical_stock_feed: SIP,
every US exchange, or IEX, one exchange) and are adjusted for splits and
dividends (see BUILD_PLAN.md, D25). Crypto bars come from Alpaca's crypto
feed. Failures become MarketDataError with a plain explanation: a refused key,
a plan that doesn't include the data asked for, no answer in time.

The clients come from strata.alpaca_clients, so every request has a time limit.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any, Literal

import requests

from .models import AssetClass, Bar, BarSeries, Level, OrderBook, Quote, Timeframe, Trade
from .providers import MarketDataError

StockFeed = Literal["sip", "iex"]
Adjustment = Literal["raw", "split", "dividend", "all"]


def _timeframe(timeframe: Timeframe) -> Any:
    from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

    return TimeFrame(1, TimeFrameUnit.Day if timeframe == "1Day" else TimeFrameUnit.Hour)


def explain_error(exc: Exception, what: str, feed: str | None) -> MarketDataError:
    """A plain-words error for anything alpaca-py or the network raises."""
    from alpaca.common.exceptions import APIError

    if isinstance(exc, APIError):
        status = getattr(exc, "status_code", None)
        text = str(exc)
        lowered = text.lower()
        if status in (401, 403) and "subscription" in lowered and feed == "sip":
            return MarketDataError(
                f"Alpaca refused {what}: your data plan doesn't include this SIP data. "
                "Set data.historical_stock_feed: iex in config.yaml, or ask only for data "
                "older than the last 15 minutes."
            )
        if status in (401, 403):
            return MarketDataError(
                f"Alpaca refused {what} (HTTP {status}): check the paper keys in .env."
            )
        if status == 429:
            return MarketDataError(
                f"Alpaca asked STRATA to slow down while fetching {what} (HTTP 429). "
                "Try again in a minute."
            )
        return MarketDataError(f"Alpaca couldn't provide {what} (HTTP {status}): {text[:200]}")
    if isinstance(exc, requests.Timeout):
        return MarketDataError(f"Alpaca didn't answer in time while fetching {what}.")
    if isinstance(exc, requests.RequestException):
        return MarketDataError(
            f"Couldn't reach Alpaca while fetching {what}: {type(exc).__name__}."
        )
    return MarketDataError(f"Fetching {what} failed: {type(exc).__name__}: {exc}")


class AlpacaMarketData:
    name = "alpaca"

    def __init__(
        self,
        stock_client: Any,
        crypto_client: Any,
        *,
        stock_feed: StockFeed,
        adjustment: Adjustment = "all",
    ) -> None:
        self._stock = stock_client
        self._crypto = crypto_client
        self.stock_feed: StockFeed = stock_feed
        self.adjustment: Adjustment = adjustment

    def feed_and_adjustment(self, asset_class: AssetClass) -> tuple[str, str]:
        return (self.stock_feed, self.adjustment) if asset_class == "stock" else ("none", "none")

    def bars(
        self, symbol: str, asset_class: AssetClass, timeframe: Timeframe, start: date, end: date
    ) -> BarSeries:
        from alpaca.data.enums import Adjustment as AlpacaAdjustment
        from alpaca.data.enums import DataFeed
        from alpaca.data.requests import CryptoBarsRequest, StockBarsRequest

        if start > end:
            raise MarketDataError(f"start {start} is after end {end}")
        # Both days included: from the first moment of `start` to the last of `end`.
        first = datetime.combine(start, time.min, UTC)
        last = datetime.combine(end, time.max, UTC)
        what = f"{timeframe} bars for {symbol} from {start} to {end}"
        try:
            if asset_class == "stock":
                barset = self._stock.get_stock_bars(
                    StockBarsRequest(
                        symbol_or_symbols=symbol,
                        timeframe=_timeframe(timeframe),
                        start=first,
                        end=last,
                        adjustment=AlpacaAdjustment(self.adjustment),
                        feed=DataFeed(self.stock_feed),
                    )
                )
            else:
                barset = self._crypto.get_crypto_bars(
                    CryptoBarsRequest(
                        symbol_or_symbols=symbol,
                        timeframe=_timeframe(timeframe),
                        start=first,
                        end=last,
                    )
                )
        except Exception as exc:
            raise explain_error(
                exc, what, self.stock_feed if asset_class == "stock" else None
            ) from exc
        rows = barset.data.get(symbol, []) if hasattr(barset, "data") else []
        bars = tuple(
            Bar(
                start=row.timestamp,
                open=float(row.open),
                high=float(row.high),
                low=float(row.low),
                close=float(row.close),
                volume=float(row.volume),
                trade_count=None if row.trade_count is None else int(row.trade_count),
                vwap=None if row.vwap is None else float(row.vwap),
            )
            for row in rows
        )
        return BarSeries(
            symbol=symbol,
            asset_class=asset_class,
            timeframe=timeframe,
            bars=bars,
            start=start,
            end=end,
            source=self.name,
            feed=self.feed_and_adjustment(asset_class)[0],
            adjustment=self.feed_and_adjustment(asset_class)[1],
        )

    def latest_quote(self, symbol: str, asset_class: AssetClass) -> Quote:
        from alpaca.data.enums import DataFeed
        from alpaca.data.requests import CryptoLatestQuoteRequest, StockLatestQuoteRequest

        try:
            if asset_class == "stock":
                quotes = self._stock.get_stock_latest_quote(
                    StockLatestQuoteRequest(
                        symbol_or_symbols=symbol, feed=DataFeed(self.stock_feed)
                    )
                )
            else:
                quotes = self._crypto.get_crypto_latest_quote(
                    CryptoLatestQuoteRequest(symbol_or_symbols=symbol)
                )
        except Exception as exc:
            raise explain_error(
                exc,
                f"the latest quote for {symbol}",
                self.stock_feed if asset_class == "stock" else None,
            ) from exc
        q = quotes[symbol]
        return Quote(
            symbol,
            q.timestamp,
            float(q.bid_price),
            float(q.bid_size),
            float(q.ask_price),
            float(q.ask_size),
        )

    def latest_trade(self, symbol: str, asset_class: AssetClass) -> Trade:
        from alpaca.data.enums import DataFeed
        from alpaca.data.requests import CryptoLatestTradeRequest, StockLatestTradeRequest

        try:
            if asset_class == "stock":
                trades = self._stock.get_stock_latest_trade(
                    StockLatestTradeRequest(
                        symbol_or_symbols=symbol, feed=DataFeed(self.stock_feed)
                    )
                )
            else:
                trades = self._crypto.get_crypto_latest_trade(
                    CryptoLatestTradeRequest(symbol_or_symbols=symbol)
                )
        except Exception as exc:
            raise explain_error(
                exc,
                f"the latest trade for {symbol}",
                self.stock_feed if asset_class == "stock" else None,
            ) from exc
        t = trades[symbol]
        return Trade(symbol, t.timestamp, float(t.price), float(t.size))

    def latest_order_book(self, symbol: str, asset_class: AssetClass) -> OrderBook | None:
        if asset_class != "crypto":
            return None
        from alpaca.data.requests import CryptoLatestOrderbookRequest

        try:
            books = self._crypto.get_crypto_latest_orderbook(
                CryptoLatestOrderbookRequest(symbol_or_symbols=symbol)
            )
        except Exception as exc:
            raise explain_error(exc, f"the order book for {symbol}", None) from exc
        book = books[symbol]
        return OrderBook(
            symbol,
            book.timestamp,
            bids=tuple(Level(float(level.price), float(level.size)) for level in book.bids),
            asks=tuple(Level(float(level.price), float(level.size)) for level in book.asks),
        )
