"""The Alpaca provider, against fake clients that return real alpaca-py objects.

No test reaches the network: the fakes record each request and answer with
the same model classes alpaca-py builds from Alpaca's replies.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
import requests
from alpaca.common.exceptions import APIError
from alpaca.data.models import BarSet, Orderbook, Quote, Trade
from alpaca.trading.models import Calendar

from strata.market_data.alpaca import AlpacaMarketData
from strata.market_data.calendars import AlpacaCalendar
from strata.market_data.providers import MarketDataError

SPY_BARS = {
    "SPY": [
        {
            "t": "2024-01-02T05:00:00Z",
            "o": 472.16,
            "h": 473.67,
            "l": 470.49,
            "c": 472.65,
            "v": 123623.0,
            "n": 1000,
            "vw": 472.1,
        },
        {
            "t": "2024-01-03T05:00:00Z",
            "o": 470.43,
            "h": 471.19,
            "l": 468.17,
            "c": 468.79,
            "v": 103585.0,
            "n": 900,
            "vw": 469.5,
        },
    ]
}
BTC_BARS = {
    "BTC/USD": [
        {
            "t": "2024-01-02T06:00:00Z",
            "o": 44000.0,
            "h": 45500.0,
            "l": 43800.0,
            "c": 45100.0,
            "v": 12.5,
            "n": 300,
            "vw": 44800.0,
        }
    ]
}


def api_error(status: int, message: str) -> APIError:
    response = requests.Response()
    response.status_code = status
    body = f'{{"message":"{message}"}}'
    return APIError(body, requests.HTTPError(response=response))


class FakeClient:
    """Records every request; answers from `replies` (or raises `error`)."""

    def __init__(self, replies=None, error: Exception | None = None):
        self.replies = replies or {}
        self.error = error
        self.requests: list[tuple[str, object]] = []

    def __getattr__(self, name):
        if not name.startswith("get_"):
            raise AttributeError(name)

        def call(request):
            self.requests.append((name, request))
            if self.error is not None:
                raise self.error
            return self.replies[name]

        return call


def provider(stock=None, crypto=None, feed="sip") -> AlpacaMarketData:
    return AlpacaMarketData(stock or FakeClient(), crypto or FakeClient(), stock_feed=feed)


def test_stock_bars_ask_for_the_configured_feed_adjusted_for_splits_and_dividends():
    stock = FakeClient({"get_stock_bars": BarSet(SPY_BARS)})
    series = provider(stock=stock, feed="iex").bars(
        "SPY", "stock", "1Day", date(2024, 1, 2), date(2024, 1, 3)
    )
    [(method, request)] = stock.requests
    assert method == "get_stock_bars"
    assert request.symbol_or_symbols == "SPY"
    assert request.feed.value == "iex"
    assert request.adjustment.value == "all"
    assert str(request.timeframe.unit.value) == "Day" and request.timeframe.amount == 1
    # Both days included, sent to Alpaca as UTC times.
    sent = request.to_request_fields()
    assert sent["start"] == "2024-01-02T00:00:00+00:00"
    assert sent["end"] == "2024-01-03T23:59:59.999999+00:00"
    assert (series.source, series.feed, series.adjustment) == ("alpaca", "iex", "all")
    assert [bar.close for bar in series.bars] == [472.65, 468.79]
    first = series.bars[0]
    assert first.start == datetime(2024, 1, 2, 5, 0, tzinfo=UTC) and first.day == date(2024, 1, 2)
    assert first.trade_count == 1000 and isinstance(first.trade_count, int)
    assert first.vwap == 472.1


def test_the_price_adjustment_can_be_changed_in_config():
    stock = FakeClient({"get_stock_bars": BarSet(SPY_BARS)})
    p = AlpacaMarketData(stock, FakeClient(), stock_feed="sip", adjustment="raw")
    series = p.bars("SPY", "stock", "1Day", date(2024, 1, 2), date(2024, 1, 3))
    assert stock.requests[0][1].adjustment.value == "raw"
    assert series.adjustment == "raw"
    assert p.feed_and_adjustment("crypto") == ("none", "none")


def test_crypto_bars_come_from_the_crypto_client():
    crypto = FakeClient({"get_crypto_bars": BarSet(BTC_BARS)})
    series = provider(crypto=crypto).bars(
        "BTC/USD", "crypto", "1Day", date(2024, 1, 2), date(2024, 1, 2)
    )
    [(method, request)] = crypto.requests
    assert method == "get_crypto_bars" and request.symbol_or_symbols == "BTC/USD"
    assert (series.feed, series.adjustment) == ("none", "none")
    assert series.bars[0].close == 45100.0


def test_no_bars_is_an_empty_series_for_the_checks_to_refuse():
    stock = FakeClient({"get_stock_bars": BarSet({})})
    assert (
        provider(stock=stock).bars("SPY", "stock", "1Day", date(2024, 1, 2), date(2024, 1, 3)).bars
        == ()
    )


@pytest.mark.parametrize(
    ("error", "feed", "message"),
    [
        (
            api_error(403, "subscription does not permit querying recent SIP data"),
            "sip",
            "data.historical_stock_feed: iex",
        ),
        (api_error(403, "forbidden"), "sip", "check the paper keys"),
        (api_error(401, "unauthorized"), "iex", "check the paper keys"),
        (api_error(429, "too many requests"), "sip", "slow down"),
        (api_error(500, "internal error"), "sip", "HTTP 500"),
        (requests.Timeout("read timed out"), "sip", "didn't answer in time"),
        (requests.ConnectionError("refused"), "sip", "Couldn't reach Alpaca"),
    ],
)
def test_failures_are_explained_in_plain_words(error, feed, message):
    stock = FakeClient(error=error)
    with pytest.raises(MarketDataError, match=message):
        provider(stock=stock, feed=feed).bars(
            "SPY", "stock", "1Day", date(2024, 1, 2), date(2024, 1, 3)
        )


def test_latest_quote_trade_and_order_book():
    quote = Quote(
        "SPY",
        {
            "t": "2024-01-02T15:00:00Z",
            "bp": 472.1,
            "bs": 3,
            "ap": 472.12,
            "as": 5,
            "bx": "V",
            "ax": "V",
            "c": ["R"],
            "z": "B",
        },
    )
    trade = Trade(
        "SPY",
        {
            "t": "2024-01-02T15:00:00Z",
            "p": 472.11,
            "s": 100,
            "x": "V",
            "i": 1,
            "c": ["@"],
            "z": "B",
        },
    )
    stock = FakeClient(
        {"get_stock_latest_quote": {"SPY": quote}, "get_stock_latest_trade": {"SPY": trade}}
    )
    book = Orderbook(
        "BTC/USD",
        {
            "t": "2024-01-02T15:00:00Z",
            "b": [{"p": 42000.1, "s": 0.5}],
            "a": [{"p": 42001.0, "s": 0.2}],
            "r": False,
        },
    )
    crypto = FakeClient({"get_crypto_latest_orderbook": {"BTC/USD": book}})
    p = provider(stock=stock, crypto=crypto)
    q = p.latest_quote("SPY", "stock")
    assert (q.bid, q.ask, q.bid_size, q.ask_size) == (472.1, 472.12, 3.0, 5.0)
    assert stock.requests[0][1].feed.value == "sip"
    assert p.latest_trade("SPY", "stock").price == 472.11
    ob = p.latest_order_book("BTC/USD", "crypto")
    assert ob is not None and ob.bids[0].price == 42000.1 and ob.asks[0].size == 0.2
    # Stocks have no order book at Alpaca: no request is made.
    assert p.latest_order_book("SPY", "stock") is None


def test_the_exchange_calendar_comes_from_alpaca_once():
    rows = [
        Calendar(date="2024-07-03", open="09:30", close="13:00"),
        Calendar(date="2024-07-05", open="09:30", close="16:00"),
    ]
    trading = FakeClient({"get_calendar": rows})
    calendar = AlpacaCalendar(trading)
    assert calendar.sessions(date(2024, 7, 3), date(2024, 7, 5)) == [
        date(2024, 7, 3),
        date(2024, 7, 5),
    ]
    calendar.sessions(date(2024, 7, 3), date(2024, 7, 5))
    assert len(trading.requests) == 1  # asked once, then remembered


def test_a_calendar_that_cant_be_had_is_explained():
    with pytest.raises(MarketDataError, match="the market calendar"):
        AlpacaCalendar(FakeClient(error=requests.Timeout("slow"))).sessions(
            date(2024, 7, 1), date(2024, 7, 5)
        )
