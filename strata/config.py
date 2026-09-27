"""Load and check config.yaml.

The bot reads every setting from config.yaml when it starts. This module
checks each one (is it present? is the value sensible? do the values fit
together?) and stops the bot with a clear message if anything is wrong.
Unknown keys and repeated keys are errors too, so a typo such as
MAX_CAPITOL, or a second MAX_CAPITAL further down the file, can never be
silently ignored.

Once loaded, the settings are read-only: nothing can change them while
the bot runs.
"""

from __future__ import annotations

import re
from collections.abc import Hashable
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from . import PROJECT_ROOT

DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config.yaml"

MIN_BACKTEST_YEARS = 3  # the whole backtest, start_date to end_date
MIN_SPLIT_YEARS = 1  # each side of the in-sample / out-of-sample split

AssetClass = Literal["stock", "crypto"]
StrategyName = Literal["ma_crossover", "rsi_reversion"]

_STOCK_SYMBOL = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")  # SPY, BRK.B
_CRYPTO_SYMBOL = re.compile(r"^[A-Z0-9]{2,10}/USD$")  # BTC/USD


class ConfigError(Exception):
    """config.yaml is missing, unreadable, or has an invalid setting."""


class _Section(BaseModel):
    """Shared rules for every section of the config.

    extra="forbid"       unknown keys are errors (catches typos)
    frozen=True          settings can't be changed after loading
    allow_inf_nan=False  ".inf" or ".nan" can't be used to switch off a limit
    """

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Instrument(_Section):
    symbol: str
    asset_class: AssetClass
    strategy: StrategyName
    enabled: bool = True

    @field_validator("symbol")
    @classmethod
    def _tidy_symbol(cls, value: str) -> str:
        return value.strip().upper()

    @model_validator(mode="after")
    def _symbol_matches_asset_class(self) -> Instrument:
        if self.asset_class == "crypto" and not _CRYPTO_SYMBOL.match(self.symbol):
            raise ValueError(
                f"crypto symbol {self.symbol!r} must be a US-dollar pair such as BTC/USD"
            )
        if self.asset_class == "stock" and not _STOCK_SYMBOL.match(self.symbol):
            raise ValueError(f"stock symbol {self.symbol!r} doesn't look like a ticker such as SPY")
        return self


class MACrossoverSettings(_Section):
    fast_period: int = Field(ge=2, le=400)
    slow_period: int = Field(ge=3, le=400)

    @model_validator(mode="after")
    def _fast_below_slow(self) -> MACrossoverSettings:
        if self.fast_period >= self.slow_period:
            raise ValueError("fast_period must be smaller than slow_period")
        return self


class RSIReversionSettings(_Section):
    rsi_period: int = Field(ge=2, le=400)
    buy_below: float = Field(gt=0, lt=100)
    sell_above: float = Field(gt=0, lt=100)

    @model_validator(mode="after")
    def _buy_below_sell(self) -> RSIReversionSettings:
        if self.buy_below >= self.sell_above:
            raise ValueError("buy_below must be smaller than sell_above")
        return self


class Strategies(_Section):
    ma_crossover: MACrossoverSettings
    rsi_reversion: RSIReversionSettings


class RiskLimits(_Section):
    """The six limits the risk manager enforces before every order."""

    MAX_CAPITAL: float = Field(gt=0)
    MAX_POSITION_PCT: float = Field(gt=0, le=100)
    STOP_LOSS_PCT: float = Field(gt=0, lt=100)
    DAILY_LOSS_LIMIT: float = Field(gt=0)
    TOTAL_LOSS_LIMIT: float = Field(gt=0)
    MAX_TRADES_PER_DAY: int = Field(ge=1)

    @model_validator(mode="after")
    def _limits_fit_together(self) -> RiskLimits:
        if self.DAILY_LOSS_LIMIT > self.TOTAL_LOSS_LIMIT:
            raise ValueError("DAILY_LOSS_LIMIT cannot be larger than TOTAL_LOSS_LIMIT")
        if self.TOTAL_LOSS_LIMIT > self.MAX_CAPITAL:
            raise ValueError("TOTAL_LOSS_LIMIT cannot be larger than MAX_CAPITAL")
        return self

    @property
    def max_position_value(self) -> float:
        """Most dollars allowed in any one position (20% of $300 = $60)."""
        return self.MAX_CAPITAL * self.MAX_POSITION_PCT / 100


class CostSettings(_Section):
    fee_pct: float = Field(ge=0, le=5)
    fee_per_sell_usd: float = Field(ge=0, le=10)
    # Must be above zero: a backtest with perfect fills flatters itself.
    slippage_pct: float = Field(gt=0, le=5)


class Costs(_Section):
    stock: CostSettings
    crypto: CostSettings

    def for_asset_class(self, asset_class: AssetClass) -> CostSettings:
        return self.stock if asset_class == "stock" else self.crypto


class BacktestSettings(_Section):
    start_date: date
    test_start_date: date
    end_date: date | None = None

    def effective_end_date(self, today: date | None = None) -> date:
        """end_date, or yesterday (the latest complete day) when end_date is null."""
        today = today or date.today()
        return self.end_date or today - timedelta(days=1)

    @model_validator(mode="after")
    def _dates_make_sense(self) -> BacktestSettings:
        today = date.today()
        end = self.effective_end_date(today)
        if self.end_date is not None and self.end_date > today:
            raise ValueError("end_date is in the future")
        if not self.start_date < self.test_start_date < end:
            raise ValueError(
                "dates must be in order: start_date, then test_start_date, then end_date"
            )
        if _add_years(self.start_date, MIN_BACKTEST_YEARS) > end:
            raise ValueError(
                f"the backtest must cover at least {MIN_BACKTEST_YEARS} years "
                "(start_date to end_date)"
            )
        if _add_years(self.start_date, MIN_SPLIT_YEARS) > self.test_start_date:
            raise ValueError(
                "the in-sample period (start_date to test_start_date) must be at least 1 year"
            )
        if _add_years(self.test_start_date, MIN_SPLIT_YEARS) > end:
            raise ValueError(
                "the out-of-sample period (test_start_date to end_date) must be at least 1 year"
            )
        return self


class DataSettings(_Section):
    historical_stock_feed: Literal["sip", "iex"]
    stock_price_adjustment: Literal["all", "split", "raw"] = "all"


class PathSettings(_Section):
    data_dir: Path
    logs_dir: Path
    state_dir: Path
    reports_dir: Path

    def resolved_against(self, base: Path) -> PathSettings:
        """Turn relative folders into absolute ones, relative to `base`."""
        fixed = {}
        for name in type(self).model_fields:
            folder = getattr(self, name)
            fixed[name] = folder if folder.is_absolute() else (base / folder).resolve()
        return PathSettings(**fixed)


class LoggingSettings(_Section):
    level: Literal["DEBUG", "INFO", "WARNING"]


class Config(_Section):
    """Everything in config.yaml, checked and read-only."""

    timezone: str
    instruments: tuple[Instrument, ...] = Field(min_length=1)
    strategies: Strategies
    risk: RiskLimits
    costs: Costs
    backtest: BacktestSettings
    data: DataSettings
    paths: PathSettings
    logging: LoggingSettings

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            raise ValueError(f"unknown time zone {value!r} (example: America/New_York)") from None
        return value

    @model_validator(mode="after")
    def _symbols_are_unique(self) -> Config:
        seen: set[str] = set()
        for instrument in self.instruments:
            if instrument.symbol in seen:
                raise ValueError(f"instrument {instrument.symbol} is listed more than once")
            seen.add(instrument.symbol)
        return self

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @property
    def enabled_instruments(self) -> tuple[Instrument, ...]:
        return tuple(i for i in self.instruments if i.enabled)


def load_config(path: str | Path = DEFAULT_CONFIG_PATH) -> Config:
    """Read config.yaml, check every setting, and return them read-only.

    Raises ConfigError, with a list of every problem found, if anything
    is wrong.
    """
    path = Path(path)
    if not path.is_file():
        raise ConfigError(f"Config file not found: {path}")
    try:
        with path.open(encoding="utf-8") as fh:
            # _StrictYamlLoader is a SafeLoader subclass (see below), so this is safe.
            raw = yaml.load(fh, Loader=_StrictYamlLoader)  # noqa: S506
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise ConfigError(f"{path} could not be read:\n{exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} should contain settings such as 'risk:' and 'instruments:'")
    try:
        config = Config.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(_explain(exc, path)) from None
    base = path.resolve().parent
    return config.model_copy(update={"paths": config.paths.resolved_against(base)})


def _explain(exc: ValidationError, path: Path) -> str:
    """Turn pydantic's error report into short, plain-English lines."""
    lines = [f"{path} has {exc.error_count()} problem(s):"]
    for error in exc.errors():
        where = ".".join(str(part) for part in error["loc"]) or "(top level)"
        if error["type"] == "extra_forbidden":
            message = "unknown setting (is it misspelled?)"
        elif error["type"] == "missing":
            message = "required setting is missing"
        else:
            message = error["msg"].removeprefix("Value error, ")
        lines.append(f"  - {where}: {message}")
    return "\n".join(lines)


def _add_years(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:  # 29 February in a year that isn't a leap year
        return day.replace(year=day.year + years, day=28)


class _StrictYamlLoader(yaml.SafeLoader):
    """A safe YAML loader that refuses repeated keys.

    Ordinary YAML silently keeps only the LAST copy of a repeated key, so a
    second 'MAX_CAPITAL: 3000' lower down the file would quietly win.
    """

    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Hashable, Any]:
        seen: set[Hashable] = set()
        for key_node, _value_node in node.value:
            if key_node.tag == "tag:yaml.org,2002:merge":
                continue
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, Hashable):
                continue  # the normal loader reports this one itself
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None,
                    None,
                    f"the setting {key!r} appears more than once",
                    key_node.start_mark,
                )
            seen.add(key)
        return super().construct_mapping(node, deep=deep)
