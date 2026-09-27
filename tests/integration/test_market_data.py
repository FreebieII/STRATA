"""Market data against a real PostgreSQL: the metadata table and `strata data`."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from strata.cli import main
from strata.db.models import MarketDataMetadata, SystemEvent
from strata.db.session import make_engine, session_factory
from strata.market_data.cache import BarCache
from strata.market_data.calendars import latest_finished_day
from strata.market_data.mock import MockMarketData
from strata.market_data.records import DatabaseMetadataStore
from strata.market_data.service import BadMarketData, MarketData
from tests.helpers import env_text


@pytest.fixture
def cli_env(migrated_url, monkeypatch, tmp_path, write_env, write_config, config_dict):
    """The `strata` command pointed at the throwaway database, with its own folders."""
    url = migrated_url
    for folder in ("data", "logs", "state", "reports"):
        config_dict["paths"][f"{folder}_dir"] = str(tmp_path / folder)
    monkeypatch.setenv("STRATA_DB_HOST", url.host)
    monkeypatch.setenv("STRATA_DB_PORT", str(url.port or 5432))
    monkeypatch.setenv("STRATA_DB_NAME", url.database)
    monkeypatch.setenv("STRATA_DB_USER", url.username)
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(write_env(env_text(db_password=url.password))))
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))
    return tmp_path / "data" / "market"


def _rows(url, symbol: str) -> list[MarketDataMetadata]:
    engine = make_engine(url)
    try:
        with session_factory(engine)() as session:
            query = select(MarketDataMetadata).where(MarketDataMetadata.symbol == symbol)
            return list(session.scalars(query.order_by(MarketDataMetadata.id)))
    finally:
        engine.dispose()


def _events(url, event_type: str) -> list[SystemEvent]:
    engine = make_engine(url)
    try:
        with session_factory(engine)() as session:
            return list(
                session.scalars(select(SystemEvent).where(SystemEvent.event_type == event_type))
            )
    finally:
        engine.dispose()


FETCH = ["data", "fetch", "--mock", "--from", "2024-01-02", "--to", "2024-06-28"]


def test_fetch_checks_caches_and_records_then_reuses(cli_env, migrated_url, capsys):
    assert main([*FETCH, "--symbol", "SPY"]) == 0
    out = capsys.readouterr().out
    assert "[ OK ] SPY" in out and "downloaded from mock" in out
    [row] = _rows(migrated_url, "SPY")
    assert row.valid and row.provider == "mock" and row.bar_count > 100
    assert row.file_name.endswith(".csv") and len(row.sha256) == 64
    assert (cli_env / row.file_name).is_file()
    assert any("SPY" in event.message for event in _events(migrated_url, "market_data_fetched"))

    assert main([*FETCH, "--symbol", "SPY"]) == 0
    assert "reused from the cache" in capsys.readouterr().out
    assert len(_rows(migrated_url, "SPY")) == 1

    assert main(["data", "check"]) == 0
    assert "hash matches its record" in capsys.readouterr().out


def test_a_changed_cache_file_fails_the_check_and_is_downloaded_again(
    cli_env, migrated_url, capsys
):
    assert main([*FETCH, "--symbol", "BTC/USD"]) == 0
    [row] = _rows(migrated_url, "BTC/USD")
    path = cli_env / row.file_name
    path.write_text(path.read_text().replace("\n2024-03-01", "\n2024-03-02", 1))
    capsys.readouterr()
    assert main(["data", "check"]) == 1
    assert "[FAIL]" in capsys.readouterr().out
    assert main([*FETCH, "--symbol", "BTC/USD"]) == 0
    assert "downloaded from mock" in capsys.readouterr().out
    assert main(["data", "check"]) == 0


def test_refused_data_is_recorded_with_its_problems_and_not_cached(migrated_url, tmp_path):
    engine = make_engine(migrated_url)
    try:
        market = MarketData(
            MockMarketData(defects={"GAPPY": ["gap"]}),
            BarCache(tmp_path),
            DatabaseMetadataStore(session_factory(engine), component="test"),
        )
        with pytest.raises(BadMarketData):
            market.daily_bars("GAPPY", "stock", date(2024, 1, 2), date(2024, 3, 28))
    finally:
        engine.dispose()
    [row] = _rows(migrated_url, "GAPPY")
    assert row.valid is False and row.file_name is None and row.sha256 is None
    assert [issue["kind"] for issue in row.issues] == ["missing_day"]
    assert list(tmp_path.iterdir()) == []
    [event] = [e for e in _events(migrated_url, "market_data_refused") if "GAPPY" in e.message]
    assert event.severity == "warning" and event.details["issues"] == 1


def test_the_database_refuses_a_cached_file_for_refused_data(migrated_url):
    engine = make_engine(migrated_url)
    try:
        with session_factory(engine)() as session:
            session.add(
                MarketDataMetadata(
                    provider="mock",
                    symbol="XYZ",
                    asset_class="stock",
                    timeframe="1Day",
                    feed="mock",
                    adjustment="none",
                    range_start=date(2024, 1, 2),
                    range_end=date(2024, 1, 5),
                    bar_count=3,
                    valid=False,
                    file_name="should-not-exist.csv",
                )
            )
            with pytest.raises(Exception, match="refused_data_not_cached"):
                session.commit()
    finally:
        engine.dispose()


def test_without_dates_each_market_is_fetched_up_to_its_latest_finished_day(
    cli_env, config_dict, write_config, monkeypatch, capsys
):
    config_dict["backtest"]["end_date"] = None
    monkeypatch.setenv("STRATA_CONFIG_FILE", str(write_config(config_dict)))
    start = datetime.now(UTC).date() - timedelta(days=20)
    before = {c: latest_finished_day(c, datetime.now(UTC)) for c in ("stock", "crypto")}
    assert main(["data", "fetch", "--mock", "--from", str(start)]) == 0
    after = {c: latest_finished_day(c, datetime.now(UTC)) for c in ("stock", "crypto")}
    out = capsys.readouterr().out
    for stem, asset_class in (("SPY_1Day_mock", "stock"), ("BTC-USD_1Day_none", "crypto")):
        names = {
            f"mock_{stem}_none_{start}_{d}.csv" for d in (before[asset_class], after[asset_class])
        }
        assert any(name in out for name in names), (names, out)


def test_fetching_from_alpaca_needs_the_paper_keys(
    cli_env, monkeypatch, write_env, migrated_url, capsys
):
    monkeypatch.setenv(
        "STRATA_SECRETS_FILE",
        str(write_env(env_text(paper=False, db_password=migrated_url.password))),
    )
    assert main(["data", "fetch", "--symbol", "SPY"]) == 2
    assert "Not started" in capsys.readouterr().err


def test_an_unknown_symbol_is_refused(cli_env, capsys):
    assert main(["data", "fetch", "--mock", "--symbol", "QQQ"]) == 2
    assert "isn't an enabled instrument" in capsys.readouterr().err
