"""Which days a market trades, and when a day's bar has finished.

Stocks trade on the exchange's sessions: weekdays that aren't market holidays.
The source of truth is the broker's calendar (AlpacaCalendar), which lists
every session, holidays and early closes included. Crypto trades every day.

A daily bar covers one day where the provider counts its days: Alpaca's stock
bars start at midnight New York time. Its crypto bars appear to start at
midnight Chicago time (05:00 UTC in summer); if they really start earlier (at
midnight UTC, say), counting crypto days in Chicago only waits longer before
calling a day finished, never less.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .models import AssetClass, Timeframe

DAY_ZONES: dict[AssetClass, ZoneInfo] = {
    "stock": ZoneInfo("America/New_York"),
    "crypto": ZoneInfo("America/Chicago"),
}

BAR_LENGTH: dict[Timeframe, timedelta] = {"1Day": timedelta(days=1), "1Hour": timedelta(hours=1)}


def finished_at(start: datetime, timeframe: Timeframe) -> datetime:
    """When a bar that starts at `start` has certainly finished. A daily bar
    starts at midnight where its days are counted, and a day there lasts 25
    hours when the clocks go back, so it counts as finished 25 hours after it
    starts, whichever time zone that is."""
    # In UTC: adding hours to a New York or Chicago time moves its clock face,
    # which is an hour out across the change.
    start = start.astimezone(UTC)
    if timeframe == "1Day":
        return start + timedelta(hours=25)
    return start + BAR_LENGTH[timeframe]


def day_start(day: date, asset_class: AssetClass) -> datetime:
    """Midnight at the start of `day` where this market's days are counted, in UTC."""
    return datetime.combine(day, time(0, 0), DAY_ZONES[asset_class]).astimezone(UTC)


def latest_finished_day(asset_class: AssetClass, now: datetime) -> date:
    """The most recent day whose daily bar has certainly finished by `now`."""
    if now.tzinfo is None:
        raise ValueError("now must have a time zone")
    day = now.astimezone(DAY_ZONES[asset_class]).date()
    while finished_at(day_start(day, asset_class), "1Day") > now:
        day -= timedelta(days=1)
    return day


class TradingCalendar(Protocol):
    name: str

    def sessions(self, start: date, end: date) -> list[date]:
        """Every trading day from start to end, both included, in order."""
        ...


def _days(start: date, end: date) -> Iterable[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


class EveryDay:
    """Crypto: every day is a trading day."""

    name = "every day"

    def sessions(self, start: date, end: date) -> list[date]:
        return list(_days(start, end))


class Weekdays:
    """Monday to Friday. It doesn't know market holidays, so use it only where
    the exact calendar isn't available (the mock provider, offline work)."""

    name = "weekdays"

    def sessions(self, start: date, end: date) -> list[date]:
        return [day for day in _days(start, end) if day.weekday() < 5]


class FixedCalendar:
    """A calendar from a known list of days (from the broker, or in tests)."""

    def __init__(self, days: Iterable[date], name: str = "fixed") -> None:
        self._days = sorted(set(days))
        self.name = name

    def sessions(self, start: date, end: date) -> list[date]:
        return [day for day in self._days if start <= day <= end]


class AlpacaCalendar:
    """The US stock market's sessions, as Alpaca's calendar lists them."""

    name = "alpaca"

    def __init__(self, trading_client: Any) -> None:
        self._client = trading_client
        self._cache: dict[tuple[date, date], list[date]] = {}

    def sessions(self, start: date, end: date) -> list[date]:
        key = (start, end)
        if key not in self._cache:
            from alpaca.trading.requests import GetCalendarRequest

            from .alpaca import explain_error

            try:
                rows = self._client.get_calendar(GetCalendarRequest(start=start, end=end))
            except Exception as exc:
                raise explain_error(exc, "the market calendar", None) from exc
            self._cache[key] = sorted(row.date for row in rows if start <= row.date <= end)
        return list(self._cache[key])


def default_calendar(asset_class: AssetClass) -> TradingCalendar:
    """Every day for crypto; weekdays for stocks when nothing better is at hand."""
    return EveryDay() if asset_class == "crypto" else Weekdays()
