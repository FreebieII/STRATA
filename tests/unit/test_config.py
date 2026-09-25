"""Tests for loading and checking config.yaml (strata/config.py)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from strata.config import ConfigError, load_config
from tests.helpers import PROJECT_ROOT

# The limits required by the project brief, exactly.
REQUIRED_RISK_LIMITS = {
    "MAX_CAPITAL": 300,
    "MAX_POSITION_PCT": 20,
    "STOP_LOSS_PCT": 5,
    "DAILY_LOSS_LIMIT": 15,
    "TOTAL_LOSS_LIMIT": 60,
    "MAX_TRADES_PER_DAY": 3,
}


@pytest.fixture
def expect_problem(config_dict, write_config):
    """Apply `change` to a copy of config.yaml and assert loading it fails."""

    def _expect(change, *fragments: str) -> str:
        change(config_dict)
        with pytest.raises(ConfigError) as info:
            load_config(write_config(config_dict))
        message = str(info.value)
        for fragment in fragments:
            assert fragment in message
        return message

    return _expect


# --- the shipped config.yaml ------------------------------------------------


def test_shipped_config_is_valid():
    config = load_config(PROJECT_ROOT / "config.yaml")
    assert config.timezone == "America/New_York"
    assert config.data.historical_stock_feed == "sip"


def test_shipped_risk_limits_match_the_requirements():
    risk = load_config(PROJECT_ROOT / "config.yaml").risk
    for name, value in REQUIRED_RISK_LIMITS.items():
        assert getattr(risk, name) == value, name
    assert risk.max_position_value == pytest.approx(60.0)  # 20% of $300


def test_shipped_instruments_and_strategies():
    config = load_config(PROJECT_ROOT / "config.yaml")
    assert [(i.symbol, i.asset_class, i.enabled) for i in config.instruments] == [
        ("SPY", "stock", True),
        ("BTC/USD", "crypto", True),
    ]
    assert config.strategies.ma_crossover.fast_period == 20
    assert config.strategies.ma_crossover.slow_period == 50
    assert config.strategies.rsi_reversion.rsi_period == 14
    assert config.strategies.rsi_reversion.buy_below == 30
    assert config.strategies.rsi_reversion.sell_above == 70


def test_shipped_backtest_covers_at_least_three_years():
    backtest = load_config(PROJECT_ROOT / "config.yaml").backtest
    assert backtest.start_date.replace(year=backtest.start_date.year + 3) <= (
        backtest.effective_end_date()
    )


def test_shipped_costs_are_not_zero():
    costs = load_config(PROJECT_ROOT / "config.yaml").costs
    assert costs.stock.slippage_pct > 0
    assert costs.crypto.slippage_pct > 0
    assert costs.crypto.fee_pct > 0
    assert costs.stock.fee_per_sell_usd > 0


def test_loaded_config_is_read_only():
    config = load_config(PROJECT_ROOT / "config.yaml")
    with pytest.raises(ValidationError):
        config.risk.MAX_CAPITAL = 1_000_000
    with pytest.raises(AttributeError):
        config.instruments.append(config.instruments[0])  # a tuple, can't grow


# --- risk limits --------------------------------------------------------------


@pytest.mark.parametrize("name", REQUIRED_RISK_LIMITS)
def test_every_risk_limit_is_required(expect_problem, name):
    expect_problem(lambda c: c["risk"].pop(name), f"risk.{name}", "missing")


@pytest.mark.parametrize("bad", [0, -1])
@pytest.mark.parametrize("name", REQUIRED_RISK_LIMITS)
def test_risk_limits_must_be_positive(expect_problem, name, bad):
    expect_problem(lambda c: c["risk"].update({name: bad}), f"risk.{name}")


@pytest.mark.parametrize("name", ["MAX_CAPITAL", "DAILY_LOSS_LIMIT", "TOTAL_LOSS_LIMIT"])
def test_infinite_limit_cannot_switch_a_limit_off(expect_problem, name):
    expect_problem(lambda c: c["risk"].update({name: float("inf")}), f"risk.{name}")


def test_misspelled_risk_limit_is_caught(expect_problem):
    def misspell(c):
        c["risk"]["MAX_CAPITOL"] = c["risk"].pop("MAX_CAPITAL")

    expect_problem(
        misspell,
        "risk.MAX_CAPITOL: unknown setting",
        "risk.MAX_CAPITAL: required setting is missing",
    )


def test_mode_cannot_be_set_in_config(expect_problem):
    expect_problem(lambda c: c.update({"mode": "live"}), "mode: unknown setting")


def test_position_pct_above_100_rejected(expect_problem):
    expect_problem(lambda c: c["risk"].update({"MAX_POSITION_PCT": 150}), "risk.MAX_POSITION_PCT")


def test_stop_loss_of_100_pct_rejected(expect_problem):
    expect_problem(lambda c: c["risk"].update({"STOP_LOSS_PCT": 100}), "risk.STOP_LOSS_PCT")


def test_max_trades_must_be_a_whole_number(expect_problem):
    expect_problem(lambda c: c["risk"].update({"MAX_TRADES_PER_DAY": 2.5}), "MAX_TRADES_PER_DAY")


def test_daily_loss_limit_cannot_exceed_total(expect_problem):
    expect_problem(
        lambda c: c["risk"].update({"DAILY_LOSS_LIMIT": 61}),
        "DAILY_LOSS_LIMIT cannot be larger than TOTAL_LOSS_LIMIT",
    )


def test_total_loss_limit_cannot_exceed_capital(expect_problem):
    expect_problem(
        lambda c: c["risk"].update({"TOTAL_LOSS_LIMIT": 301}),
        "TOTAL_LOSS_LIMIT cannot be larger than MAX_CAPITAL",
    )


def test_a_repeated_setting_is_refused(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("risk:\n  MAX_CAPITAL: 300\n  MAX_CAPITAL: 3000\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="'MAX_CAPITAL' appears more than once"):
        load_config(path)


def test_a_repeated_section_is_refused(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("risk:\n  MAX_CAPITAL: 300\nrisk:\n  MAX_CAPITAL: 3000\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="'risk' appears more than once"):
        load_config(path)


# --- instruments and strategies ----------------------------------------------------


def test_symbols_are_tidied(config_dict, write_config):
    config_dict["instruments"][0]["symbol"] = " spy "
    assert load_config(write_config(config_dict)).instruments[0].symbol == "SPY"


def test_duplicate_instrument_rejected(expect_problem):
    expect_problem(
        lambda c: c["instruments"].append(dict(c["instruments"][0])), "listed more than once"
    )


@pytest.mark.parametrize("symbol", ["BTC/EUR", "BTCUSD", "ETH/BTC", "BTC/USDT"])
def test_crypto_must_be_a_us_dollar_pair(expect_problem, symbol):
    expect_problem(lambda c: c["instruments"][1].update({"symbol": symbol}), "US-dollar pair")


def test_stock_symbol_cannot_look_like_crypto(expect_problem):
    expect_problem(lambda c: c["instruments"][0].update({"symbol": "BTC/USD"}), "ticker")


def test_unknown_strategy_rejected(expect_problem):
    expect_problem(lambda c: c["instruments"][0].update({"strategy": "macd"}), "strategy")


def test_unknown_asset_class_rejected(expect_problem):
    expect_problem(lambda c: c["instruments"][0].update({"asset_class": "option"}), "asset_class")


def test_at_least_one_instrument_needed(expect_problem):
    expect_problem(lambda c: c.update({"instruments": []}), "instruments")


def test_disabled_instrument_is_left_out(config_dict, write_config):
    config_dict["instruments"][0]["enabled"] = False
    config = load_config(write_config(config_dict))
    assert [i.symbol for i in config.enabled_instruments] == ["BTC/USD"]


def test_fast_average_must_be_shorter_than_slow(expect_problem):
    expect_problem(
        lambda c: c["strategies"]["ma_crossover"].update({"fast_period": 50, "slow_period": 20}),
        "fast_period must be smaller than slow_period",
    )


def test_rsi_buy_level_must_be_below_sell_level(expect_problem):
    expect_problem(
        lambda c: c["strategies"]["rsi_reversion"].update({"buy_below": 70, "sell_above": 30}),
        "buy_below must be smaller than sell_above",
    )


# --- costs ------------------------------------------------------------------------


@pytest.mark.parametrize("asset_class", ["stock", "crypto"])
def test_slippage_cannot_be_zero(expect_problem, asset_class):
    expect_problem(
        lambda c: c["costs"][asset_class].update({"slippage_pct": 0}),
        f"costs.{asset_class}.slippage_pct",
    )


def test_fees_cannot_be_negative(expect_problem):
    expect_problem(lambda c: c["costs"]["crypto"].update({"fee_pct": -0.1}), "costs.crypto.fee_pct")


# --- backtest dates -------------------------------------------------------------------


def _dates(start, test_start, end=None):
    return lambda c: c["backtest"].update(
        {"start_date": start, "test_start_date": test_start, "end_date": end}
    )


def test_backtest_needs_three_years(expect_problem):
    expect_problem(
        _dates(date(2023, 6, 1), date(2024, 7, 1), date(2026, 5, 31)), "at least 3 years"
    )


def test_backtest_dates_must_be_in_order(expect_problem):
    expect_problem(_dates(date(2021, 1, 1), date(2020, 1, 1)), "must be in order")


def test_out_of_sample_period_needs_a_year(expect_problem):
    expect_problem(
        _dates(date(2021, 1, 1), date(2025, 12, 1), date(2026, 6, 1)), "out-of-sample period"
    )


def test_in_sample_period_needs_a_year(expect_problem):
    expect_problem(_dates(date(2021, 1, 1), date(2021, 6, 1), date(2026, 6, 1)), "in-sample period")


def test_backtest_end_date_cannot_be_in_the_future(expect_problem):
    future = date.today() + timedelta(days=30)
    expect_problem(_dates(date(2021, 1, 1), date(2024, 7, 1), future), "in the future")


def test_fixed_end_date_is_used(config_dict, write_config):
    _dates(date(2021, 1, 1), date(2024, 7, 1), date(2026, 6, 30))(config_dict)
    backtest = load_config(write_config(config_dict)).backtest
    assert backtest.effective_end_date() == date(2026, 6, 30)


def test_null_end_date_means_yesterday():
    backtest = load_config(PROJECT_ROOT / "config.yaml").backtest
    assert backtest.effective_end_date(date(2026, 9, 25)) == date(2026, 9, 24)


# --- other settings --------------------------------------------------------------------


@pytest.mark.parametrize("zone", ["Mars/Base", "America", ""])
def test_unknown_time_zone_rejected(expect_problem, zone):
    expect_problem(lambda c: c.update({"timezone": zone}), "timezone")


def test_unknown_stock_feed_rejected(expect_problem):
    expect_problem(lambda c: c["data"].update({"historical_stock_feed": "best"}), "data.")


def test_unknown_log_level_rejected(expect_problem):
    expect_problem(lambda c: c["logging"].update({"level": "LOUD"}), "logging.level")


def test_relative_folders_are_next_to_the_config_file(config_dict, write_config, tmp_path):
    config = load_config(write_config(config_dict))
    assert config.paths.logs_dir == (tmp_path / "logs").resolve()
    assert config.paths.state_dir == (tmp_path / "state").resolve()


def test_absolute_folders_are_kept(config_dict, write_config, tmp_path):
    elsewhere = (tmp_path / "somewhere" / "logs").resolve()
    config_dict["paths"]["logs_dir"] = str(elsewhere)
    assert load_config(write_config(config_dict)).paths.logs_dir == elsewhere


# --- unreadable files ------------------------------------------------------------------


def test_missing_file_is_reported(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "nope.yaml")


def test_broken_yaml_is_reported(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("risk: [unclosed\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="could not be read"):
        load_config(path)


def test_empty_file_is_reported(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("", encoding="utf-8")
    with pytest.raises(ConfigError, match="should contain settings"):
        load_config(path)


def test_every_problem_is_listed_at_once(expect_problem):
    def two_problems(c):
        c["risk"]["MAX_CAPITAL"] = -1
        c["costs"]["stock"]["slippage_pct"] = 0

    message = expect_problem(two_problems, "2 problem(s)")
    assert "risk.MAX_CAPITAL" in message
    assert "costs.stock.slippage_pct" in message
