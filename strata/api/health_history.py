"""The API's own record of its health checks, for the dashboard's charts.

A background task runs the health checks every 15 seconds and keeps 24
hours of results in memory. They are lost when the API restarts; from
Phase 8 the scheduler keeps them permanently. When a check starts or stops
failing, a system event is stored, so outages also appear in the event log.

A change is only reported once two readings in a row agree, so a single
slow moment doesn't flood the log.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from ..health import ComponentHealth
from ..logging_setup import log_event

SAMPLE_EVERY_S = 15
KEEP = timedelta(hours=24)
# How many readings in a row must agree before a change is reported.
CONFIRM_AFTER = 2

Window = Literal["1h", "6h", "24h"]
# window -> (length, bucket size), both in seconds
WINDOWS: dict[Window, tuple[int, int]] = {
    "1h": (3600, 60),
    "6h": (6 * 3600, 300),
    "24h": (24 * 3600, 1200),
}


@dataclass(frozen=True)
class Reading:
    name: str
    ok: bool
    latency_ms: float | None
    detail: str


@dataclass(frozen=True)
class Sample:
    at: datetime
    readings: tuple[Reading, ...]


@dataclass(frozen=True)
class Change:
    """A check that started or stopped failing."""

    name: str
    ok: bool
    detail: str
    # How long it had been in its previous state, if known.
    after: timedelta | None


@dataclass(frozen=True)
class Point:
    start: datetime
    samples: int
    failed: int
    latency_avg_ms: float | None
    latency_max_ms: float | None


@dataclass(frozen=True)
class Series:
    name: str
    points: tuple[Point, ...]
    availability_pct: float | None


class HealthHistory:
    """Readings from the last 24 hours, oldest first. Safe to use from threads."""

    def __init__(self, keep: timedelta = KEEP) -> None:
        self._keep = keep
        self._samples: deque[Sample] = deque()
        self._lock = threading.Lock()
        # name -> (reported state, since when)
        self._reported: dict[str, tuple[bool, datetime]] = {}
        # name -> readings in a row that disagree with the reported state
        self._disagreeing: dict[str, int] = {}
        self.recording_since: datetime | None = None

    def add(self, at: datetime, checks: Iterable[ComponentHealth]) -> list[Change]:
        """Store one round of readings; return the checks whose state changed."""
        readings = tuple(Reading(c.name, c.ok, c.latency_ms, c.detail) for c in checks)
        changes: list[Change] = []
        with self._lock:
            if self.recording_since is None:
                self.recording_since = at
            self._samples.append(Sample(at, readings))
            while self._samples and self._samples[0].at < at - self._keep:
                self._samples.popleft()
            for reading in readings:
                change = self._track(at, reading)
                if change is not None:
                    changes.append(change)
        return changes

    def _track(self, at: datetime, reading: Reading) -> Change | None:
        reported = self._reported.get(reading.name)
        if reported is None:
            # The first reading sets the starting state; a check failing
            # from the start is worth an event, a working one isn't.
            self._reported[reading.name] = (reading.ok, at)
            return None if reading.ok else Change(reading.name, False, reading.detail, None)
        state, since = reported
        if reading.ok == state:
            self._disagreeing[reading.name] = 0
            return None
        count = self._disagreeing.get(reading.name, 0) + 1
        if count < CONFIRM_AFTER:
            self._disagreeing[reading.name] = count
            return None
        self._disagreeing[reading.name] = 0
        self._reported[reading.name] = (reading.ok, at)
        return Change(reading.name, reading.ok, reading.detail, at - since)

    def summary(self, window: Window, now: datetime) -> list[Series]:
        """The readings in `window`, grouped into equal time buckets per check."""
        length_s, bucket_s = WINDOWS[window]
        count = length_s // bucket_s
        epoch = now.timestamp()
        last_start = epoch - epoch % bucket_s
        first_start = last_start - (count - 1) * bucket_s

        with self._lock:
            samples = [s for s in self._samples if s.at.timestamp() >= first_start]
        names: list[str] = []
        for sample in samples:
            for reading in sample.readings:
                if reading.name not in names:
                    names.append(reading.name)

        series = []
        for name in names:
            buckets: list[list[Reading]] = [[] for _ in range(count)]
            for sample in samples:
                index = int((sample.at.timestamp() - first_start) // bucket_s)
                if 0 <= index < count:
                    buckets[index].extend(r for r in sample.readings if r.name == name)
            points = tuple(
                _point(datetime.fromtimestamp(first_start + i * bucket_s, UTC), readings)
                for i, readings in enumerate(buckets)
            )
            total = sum(p.samples for p in points)
            failed = sum(p.failed for p in points)
            availability = round(100 * (total - failed) / total, 2) if total else None
            series.append(Series(name, points, availability))
        return series


def _point(start: datetime, readings: list[Reading]) -> Point:
    latencies = [r.latency_ms for r in readings if r.ok and r.latency_ms is not None]
    return Point(
        start=start,
        samples=len(readings),
        failed=sum(1 for r in readings if not r.ok),
        latency_avg_ms=round(sum(latencies) / len(latencies), 2) if latencies else None,
        latency_max_ms=round(max(latencies), 2) if latencies else None,
    )


def describe_change(change: Change) -> tuple[str, str, str]:
    """(event type, severity, message) for the system event about a change."""
    if change.ok:
        was = f" after {_duration(change.after)}" if change.after else ""
        return "health_recovered", "info", f"{change.name} check is working again{was}"
    return "health_failed", "error", f"{change.name} check is failing: {change.detail}"


def _duration(delta: timedelta) -> str:
    seconds = int(delta.total_seconds())
    if seconds < 120:
        return f"{seconds} s"
    if seconds < 7200:
        return f"{seconds // 60} min"
    return f"{seconds // 3600} h {seconds % 3600 // 60} min"


def sample_once(
    history: HealthHistory,
    health_checks: Callable[[], list[ComponentHealth]],
    record_event: Callable[..., None],
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> list[Change]:
    """Take one round of readings, and store an event for each change."""
    changes = history.add(now(), health_checks())
    for change in changes:
        event_type, severity, message = describe_change(change)
        log_event(
            event_type,
            message,
            level=logging.INFO if change.ok else logging.ERROR,
            check=change.name,
        )
        record_event(
            event_type,
            message,
            severity=severity,
            details={"check": change.name, "detail": change.detail},
        )
    return changes


class Sampler:
    """Takes a reading now and then every `every_s` seconds, in its own thread.

    stop() waits for a reading in progress to finish, so the connections it
    uses can be closed safely afterwards.
    """

    def __init__(
        self,
        history: HealthHistory,
        health_checks: Callable[[], list[ComponentHealth]],
        record_event: Callable[..., None],
        every_s: float,
    ) -> None:
        self._history = history
        self._health_checks = health_checks
        self._record_event = record_event
        self._every_s = every_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="strata-health", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout_s: float = 30) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout_s)

    def _run(self) -> None:
        while True:
            try:
                sample_once(self._history, self._health_checks, self._record_event)
            except Exception:  # a failed reading must never stop the readings
                logging.getLogger("strata.api").warning(
                    "could not take a health reading", exc_info=True
                )
            if self._stop.wait(self._every_s):
                return
