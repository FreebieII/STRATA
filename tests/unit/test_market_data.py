"""Market data: the models, calendars, checks, cache and mock provider."""

from __future__ import annotations

import json
import math
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta, timezone

import pytest

from strata.market_data.cache import BarCache, CacheError, CacheKey, decode, encode
from strata.market_data.calendars import (
    EveryDay,
    FixedCalendar,
    Weekdays,
    default_calendar,
    finished_at,
    latest_finished_day,
)
from strata.market_data.mock import MockMarketData, mock_series
from strata.market_data.models import Bar, BarSeries, Level, OrderBook, Quote
from strata.market_data.providers import MarketDataError
from strata.market_data.validation import MAX_DAILY_MOVE, validate_bars


def day(text: str) -> date:
    return date.fromisoformat(text)


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def series_of(bars: list[Bar], *, start: str, end: str, asset_class="stock") -> BarSeries:
    return BarSeries(
        "SPY" if asset_class == "stock" else "BTC/USD",
        asset_class,
        "1Day",
        tuple(bars),
        day(start),
        day(end),
        "test",
        "sip",
        "all",
    )


def bar(when: str, close: float = 100.0, **changes) -> Bar:
    values = {
        "open": close,
        "high": close * 1.01,
        "low": close * 0.99,
        "close": close,
        "volume": 1000.0,
    }
    values.update(changes)
    return Bar(at(when), **values)


# --- models ------------------------------------------------------------------------


def test_times_must_have_a_zone_and_are_kept_in_utc():
    with pytest.raises(ValueError, match="time zone"):
        Bar(datetime(2024, 1, 2), 1, 1, 1, 1, 1)
    new_york = timezone(timedelta(hours=-5))
    b = Bar(datetime(2024, 1, 2, 0, 0, tzinfo=new_york), 1, 1, 1, 1, 1)
    assert b.start == at("2024-01-02T05:00:00")
    assert b.day == day("2024-01-02")


def test_quotes_and_order_books():
    q = Quote("SPY", at("2024-01-02T15:00:00"), bid=100.0, bid_size=3, ask=100.02, ask_size=5)
    assert q.spread == pytest.approx(0.02)
    assert q.mid == pytest.approx(100.01)
    book = OrderBook(
        "BTC/USD",
        at("2024-01-02T15:00:00"),
        bids=(Level(99, 1), Level(100, 2)),
        asks=(Level(102, 1), Level(101, 2)),
    )
    assert [lv.price for lv in book.bids] == [100, 99]
    assert [lv.price for lv in book.asks] == [101, 102]


# --- calendars ------------------------------------------------------------------------


def test_calendars():
    # 2024-06-28 was a Friday.
    assert Weekdays().sessions(day("2024-06-28"), day("2024-07-02")) == [
        day("2024-06-28"),
        day("2024-07-01"),
        day("2024-07-02"),
    ]
    assert len(EveryDay().sessions(day("2024-06-28"), day("2024-07-02"))) == 5
    fixed = FixedCalendar([day("2024-07-03"), day("2024-07-01"), day("2024-07-01")])
    assert fixed.sessions(day("2024-06-01"), day("2024-07-02")) == [day("2024-07-01")]
    assert default_calendar("crypto").name == "every day"
    assert default_calendar("stock").name == "weekdays"


def test_the_latest_finished_day_is_counted_where_the_market_counts_days():
    # 12:00 UTC on 2 July 2024 is 08:00 in New York: 1 July is the latest finished day.
    assert latest_finished_day("stock", at("2024-07-02T12:00:00")) == day("2024-07-01")
    # 1 July's bar started at midnight New York time (04:00 UTC) and counts as
    # finished 25 hours later, at 05:00 UTC on 2 July.
    assert latest_finished_day("stock", at("2024-07-02T04:59:00")) == day("2024-06-30")
    assert latest_finished_day("stock", at("2024-07-02T05:00:00")) == day("2024-07-01")
    # Crypto days are counted in Chicago, an hour behind New York.
    assert latest_finished_day("crypto", at("2024-07-02T05:59:00")) == day("2024-06-30")
    assert latest_finished_day("crypto", at("2024-07-02T06:00:00")) == day("2024-07-01")


def test_a_day_when_the_clocks_go_back_lasts_25_hours():
    # 3 November 2024 in Chicago ran from 05:00 UTC to 06:00 UTC the next day.
    start = at("2024-11-03T05:00:00")
    assert finished_at(start, "1Day") == at("2024-11-04T06:00:00")
    assert latest_finished_day("crypto", at("2024-11-04T05:30:00")) == day("2024-11-02")
    assert latest_finished_day("crypto", at("2024-11-04T06:00:00")) == day("2024-11-03")
    sunday = Bar(start, 100.0, 101.0, 99.0, 100.0, 5.0)
    series = series_of([sunday], start="2024-11-03", end="2024-11-03", asset_class="crypto")
    # A plain 24 hours would call it finished at 05:00 UTC, an hour too soon.
    assert [i.kind for i in validate_bars(series, now=at("2024-11-04T05:30:00")).issues] == [
        "incomplete"
    ]


# --- validation ----------------------------------------------------------------------


def test_clean_data_passes():
    series = mock_series(days=40)
    report = validate_bars(series, Weekdays())
    assert report.ok, report.summary()
    assert report.summary().endswith("no problems")


@pytest.mark.parametrize(
    ("defect", "kind"),
    [
        ("duplicate", "duplicate"),
        ("gap", "missing_day"),
        ("bad_price", "bad_price"),
        ("inconsistent", "inconsistent_bar"),
        ("spike", "implausible_move"),
        ("out_of_order", "out_of_order"),
    ],
)
def test_each_kind_of_bad_data_is_found(defect, kind):
    provider = MockMarketData(defects={"SPY": [defect]})
    series = provider.bars("SPY", "stock", "1Day", day("2024-01-01"), day("2024-03-29"))
    report = validate_bars(series, Weekdays())
    assert not report.ok
    assert kind in {issue.kind for issue in report.issues}, report.summary()


def test_empty_data_is_refused():
    report = validate_bars(series_of([], start="2024-01-02", end="2024-01-05"))
    assert [issue.kind for issue in report.issues] == ["empty"]


def test_bars_outside_the_range_or_on_closed_days_are_refused():
    bars = [bar("2024-01-01T05:00:00"), bar("2024-01-06T05:00:00"), bar("2024-01-08T05:00:00")]
    report = validate_bars(
        series_of(bars, start="2024-01-02", end="2024-01-08"), FixedCalendar([day("2024-01-08")])
    )
    kinds = [issue.kind for issue in report.issues]
    assert "outside_range" in kinds  # 1 January is before the start
    assert "unexpected_day" in kinds  # Saturday 6 January


def test_prices_that_cant_be_real_are_refused():
    cases = {
        "zero": bar("2024-01-02T05:00:00", close=0.0),
        "not a number": bar("2024-01-02T05:00:00", high=math.nan),
        "infinite": bar("2024-01-02T05:00:00", low=math.inf),
    }
    for name, broken in cases.items():
        report = validate_bars(series_of([broken], start="2024-01-02", end="2024-01-02"))
        assert [i.kind for i in report.issues] == ["bad_price"], name
    negative = bar("2024-01-02T05:00:00", volume=-5.0)
    assert [
        i.kind
        for i in validate_bars(series_of([negative], start="2024-01-02", end="2024-01-02")).issues
    ] == ["negative_volume"]


def test_moves_are_judged_by_asset_class():
    # A 30% day is refused for a stock but believable for crypto.
    bars = [bar("2024-01-02T00:00:00", 100.0), bar("2024-01-03T00:00:00", 130.0)]
    stock = validate_bars(series_of(bars, start="2024-01-02", end="2024-01-03"))
    crypto = validate_bars(
        series_of(bars, start="2024-01-02", end="2024-01-03", asset_class="crypto")
    )
    assert [i.kind for i in stock.issues] == ["implausible_move"]
    assert crypto.ok
    assert MAX_DAILY_MOVE["stock"] < 0.30 < MAX_DAILY_MOVE["crypto"]


def test_unfinished_and_stale_bars_are_refused():
    bars = [bar("2024-01-02T05:00:00"), bar("2024-01-03T05:00:00")]
    series = series_of(bars, start="2024-01-02", end="2024-01-03")
    # Midday on the 3rd: that day's bar isn't finished.
    unfinished = validate_bars(series, now=at("2024-01-03T17:00:00"))
    assert [i.kind for i in unfinished.issues] == ["incomplete"]
    assert validate_bars(series, now=at("2024-01-04T06:00:00")).ok
    stale = validate_bars(series, now=at("2024-01-10T06:00:00"), max_age=timedelta(days=2))
    assert [i.kind for i in stale.issues] == ["stale"]


def test_long_lists_of_problems_are_summarised():
    provider = MockMarketData(
        defects={"SPY": ["gap", "duplicate", "bad_price", "spike", "inconsistent"]}
    )
    series = provider.bars("SPY", "stock", "1Day", day("2024-01-01"), day("2024-03-29"))
    summary = validate_bars(series, Weekdays()).summary()
    assert "and " in summary and "more" in summary
    assert "missing day" in summary


# --- the cache ------------------------------------------------------------------------


def test_bars_survive_the_round_trip_exactly():
    series = mock_series(days=20)
    b = series.bars[0]
    awkward = replace(b, close=0.1 + 0.2, vwap=1 / 3, trade_count=7)
    assert decode(encode((awkward, *series.bars[1:]))) == (awkward, *series.bars[1:])


def test_saved_series_load_back_the_same(tmp_path):
    cache = BarCache(tmp_path)
    series = mock_series(days=20)
    saved = cache.save(series, fetched_at=at("2024-07-01T00:00:00"))
    loaded, file = cache.load(CacheKey.of(series), expected_sha256=saved.sha256)
    assert loaded == series
    assert file.sha256 == saved.sha256 and file.bar_count == len(series.bars)
    assert cache.files() == [saved.path]
    assert cache.key_of(saved.path) == CacheKey.of(series)
    # Nothing half-written is left behind.
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted(
        [saved.path.name, saved.path.name.replace(".csv", ".meta.json")]
    )


def test_a_missing_file_is_simply_not_cached(tmp_path):
    assert BarCache(tmp_path).load(CacheKey.of(mock_series())) is None


def test_a_changed_or_damaged_file_is_refused(tmp_path):
    cache = BarCache(tmp_path)
    series = mock_series(days=20)
    saved = cache.save(series, fetched_at=at("2024-07-01T00:00:00"))
    key = CacheKey.of(series)

    # Someone edits a price: the hash no longer matches its description.
    text = saved.path.read_text()
    saved.path.write_text(text.replace(",", ",9", 1))
    with pytest.raises(CacheError, match="doesn't match the hash"):
        cache.load(key)

    # Even with the description edited to match, the database's record catches it.
    meta_path = saved.path.with_name(saved.path.name.replace(".csv", ".meta.json"))
    meta = json.loads(meta_path.read_text())
    import hashlib

    meta["sha256"] = hashlib.sha256(saved.path.read_bytes()).hexdigest()
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(CacheError, match="recorded in the database"):
        cache.load(key, expected_sha256=saved.sha256)


def test_a_description_that_doesnt_match_is_refused(tmp_path):
    cache = BarCache(tmp_path)
    series = mock_series(days=20)
    saved = cache.save(series, fetched_at=at("2024-07-01T00:00:00"))
    meta_path = saved.path.with_name(saved.path.name.replace(".csv", ".meta.json"))
    meta = json.loads(meta_path.read_text())
    meta["symbol"] = "QQQ"
    meta_path.write_text(json.dumps(meta))
    with pytest.raises(CacheError, match="different data"):
        cache.load(CacheKey.of(series))
    meta_path.write_text("not json")
    with pytest.raises(CacheError, match="can't be read"):
        cache.load(CacheKey.of(series))


def test_crypto_symbols_make_safe_file_names():
    key = CacheKey.of(mock_series("BTC/USD", "crypto"))
    assert "/" not in key.stem and key.stem.startswith("mock_BTC-USD_1Day_none_none_")


# --- the mock provider -----------------------------------------------------------------


def test_the_mock_is_the_same_every_time_and_whatever_the_range():
    a = MockMarketData(seed=3).bars("SPY", "stock", "1Day", day("2024-01-01"), day("2024-06-28"))
    b = MockMarketData(seed=3).bars("SPY", "stock", "1Day", day("2024-03-01"), day("2024-03-29"))
    by_day = {bar.day: bar for bar in a.bars}
    assert all(by_day[bar.day] == bar for bar in b.bars)
    assert a.source == "mock" and a.feed == "mock"
    assert (
        MockMarketData(seed=4).bars("SPY", "stock", "1Day", day("2024-03-01"), day("2024-03-29"))
        != b
    )


def test_mock_bars_start_at_midnight_where_the_market_counts_days():
    mock = MockMarketData()
    summer = mock.bars("SPY", "stock", "1Day", day("2024-07-01"), day("2024-07-01")).bars[0]
    winter = mock.bars("SPY", "stock", "1Day", day("2024-01-02"), day("2024-01-02")).bars[0]
    assert (summer.start, winter.start) == (at("2024-07-01T04:00:00"), at("2024-01-02T05:00:00"))
    crypto = mock.bars("BTC/USD", "crypto", "1Day", day("2024-07-01"), day("2024-07-01")).bars[0]
    assert crypto.start == at("2024-07-01T05:00:00") and crypto.day == day("2024-07-01")


def test_the_mock_makes_crypto_every_day_and_refuses_what_it_cant_do():
    crypto = MockMarketData().bars(
        "BTC/USD", "crypto", "1Day", day("2024-06-28"), day("2024-07-02")
    )
    assert len(crypto.bars) == 5 and crypto.feed == "none"
    with pytest.raises(MarketDataError, match="daily"):
        MockMarketData().bars("SPY", "stock", "1Hour", day("2024-06-28"), day("2024-07-02"))
    with pytest.raises(ValueError, match="unknown defects"):
        MockMarketData(defects={"SPY": ["typo"]})


def test_the_mock_quotes_trades_and_order_books():
    now = at("2024-07-01T15:00:00")
    provider = MockMarketData(now=lambda: now)
    quote = provider.latest_quote("SPY", "stock")
    assert quote.bid < quote.ask and quote.time == now
    assert provider.latest_trade("SPY", "stock").price > 0
    assert provider.latest_order_book("SPY", "stock") is None
    book = provider.latest_order_book("BTC/USD", "crypto")
    assert book is not None and book.bids[0].price < book.asks[0].price
