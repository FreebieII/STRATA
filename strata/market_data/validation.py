"""Checks that refuse bad market data before anything uses it.

A bar series is refused if it has any issue: nothing, duplicates, bars out of
order or outside the range asked for, impossible prices (zero, negative, not a
number, a high below the low), negative volume, a trading day missing or a day
that shouldn't be there (checked against the market's calendar), a move too
big to be real, a bar that hasn't finished yet (so it could still change), or,
when asked, a latest bar that is too old.

These are the rules the brief asks for: "bad data is detected and refused". A
backtest on data with a hole in it, or an indicator fed a wrong price, gives a
wrong answer that looks right.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from itertools import pairwise
from typing import Literal

from .calendars import BAR_LENGTH, TradingCalendar, finished_at
from .models import AssetClass, Bar, BarSeries

IssueKind = Literal[
    "empty",
    "duplicate",
    "out_of_order",
    "outside_range",
    "bad_price",
    "inconsistent_bar",
    "negative_volume",
    "missing_day",
    "unexpected_day",
    "implausible_move",
    "incomplete",
    "stale",
]

# The biggest close-to-close move in one day that is believable. SPY's worst
# day since 1993 was about -11% (16 March 2020); bitcoin has fallen by close to
# 40% in a day. Anything beyond these is far more likely a bad price.
MAX_DAILY_MOVE: dict[AssetClass, float] = {"stock": 0.20, "crypto": 0.50}

# Long lists of problems are summarised: the first few, then a count.
_SHOWN = 5


@dataclass(frozen=True, slots=True)
class Issue:
    kind: IssueKind
    detail: str
    # The day or moment it concerns, as ISO text; None for the whole series.
    at: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return {"kind": self.kind, "at": self.at, "detail": self.detail}


@dataclass(frozen=True, slots=True)
class ValidationReport:
    checked: int
    issues: tuple[Issue, ...] = field(default=())

    @property
    def ok(self) -> bool:
        return not self.issues

    def summary(self) -> str:
        if self.ok:
            return f"{self.checked} bars, no problems"
        counts: dict[str, int] = {}
        for issue in self.issues:
            counts[issue.kind] = counts.get(issue.kind, 0) + 1
        found = ", ".join(f"{n} {kind.replace('_', ' ')}" for kind, n in counts.items())
        examples = "; ".join(issue.detail for issue in self.issues[:_SHOWN])
        more = f" (and {len(self.issues) - _SHOWN} more)" if len(self.issues) > _SHOWN else ""
        return f"{self.checked} bars: {found}. {examples}{more}"


def _finite_positive(value: float) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _bar_problems(bar: Bar) -> list[Issue]:
    at = bar.start.isoformat()
    problems: list[Issue] = []
    prices = {"open": bar.open, "high": bar.high, "low": bar.low, "close": bar.close}
    bad = [name for name, value in prices.items() if not _finite_positive(value)]
    if bad:
        problems.append(Issue("bad_price", f"{at}: {', '.join(bad)} not a positive number", at))
        return problems
    if (
        bar.high < bar.low
        or bar.high < max(bar.open, bar.close)
        or bar.low > min(bar.open, bar.close)
    ):
        problems.append(
            Issue(
                "inconsistent_bar",
                f"{at}: open {bar.open}, high {bar.high}, low {bar.low}, close {bar.close} "
                "don't fit together",
                at,
            )
        )
    if not (math.isfinite(bar.volume) and bar.volume >= 0):
        problems.append(Issue("negative_volume", f"{at}: volume {bar.volume}", at))
    return problems


def validate_bars(
    series: BarSeries,
    calendar: TradingCalendar | None = None,
    *,
    now: datetime | None = None,
    max_age: timedelta | None = None,
) -> ValidationReport:
    """Every problem in `series`. Pass a calendar to check for missing days
    (daily bars only), `now` to refuse bars that haven't finished yet, and
    `max_age` as well to refuse stale data."""
    bars = series.bars
    issues: list[Issue] = []
    if not bars:
        return ValidationReport(
            0, (Issue("empty", f"no bars for {series.symbol} from {series.start} to {series.end}"),)
        )

    for bar in bars:
        issues.extend(_bar_problems(bar))
        if not series.start <= bar.day <= series.end:
            issues.append(
                Issue(
                    "outside_range",
                    f"{bar.day}: outside {series.start} to {series.end}",
                    bar.day.isoformat(),
                )
            )

    for before, after in pairwise(bars):
        if after.start == before.start:
            issues.append(
                Issue("duplicate", f"{after.start.isoformat()}: two bars", after.start.isoformat())
            )
        elif after.start < before.start:
            issues.append(
                Issue(
                    "out_of_order",
                    f"{after.start.isoformat()} comes after {before.start.isoformat()}",
                    after.start.isoformat(),
                )
            )

    if series.timeframe == "1Day":
        limit = MAX_DAILY_MOVE[series.asset_class]
        for before, after in pairwise(bars):
            if _finite_positive(before.close) and _finite_positive(after.close):
                move = after.close / before.close - 1
                if abs(move) > limit:
                    issues.append(
                        Issue(
                            "implausible_move",
                            f"{after.day}: close moved {move:+.1%} in a day "
                            f"(more than {limit:.0%} is not believable)",
                            after.day.isoformat(),
                        )
                    )
        if calendar is not None:
            expected = set(calendar.sessions(series.start, series.end))
            actual = set(series.days)
            for day in sorted(expected - actual):
                issues.append(
                    Issue(
                        "missing_day",
                        f"{day}: no bar for a {calendar.name} trading day",
                        day.isoformat(),
                    )
                )
            for day in sorted(actual - expected):
                if series.start <= day <= series.end:
                    issues.append(
                        Issue(
                            "unexpected_day",
                            f"{day}: a bar on a day the market was closed",
                            day.isoformat(),
                        )
                    )

    if now is not None:
        for bar in bars:
            if finished_at(bar.start, series.timeframe) > now:
                issues.append(
                    Issue(
                        "incomplete",
                        f"{bar.start.isoformat()}: the bar hasn't finished yet",
                        bar.start.isoformat(),
                    )
                )
    if now is not None and max_age is not None:
        latest = max(bar.start for bar in bars) + BAR_LENGTH[series.timeframe]
        if now - latest > max_age:
            issues.append(
                Issue(
                    "stale",
                    f"the latest bar ended {latest.isoformat()}, "
                    f"more than {max_age} before {now.isoformat()}",
                )
            )
    return ValidationReport(len(bars), tuple(issues))
