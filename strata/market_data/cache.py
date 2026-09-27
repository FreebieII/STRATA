"""Downloaded price history, kept on disk so it isn't fetched again.

Each series is a CSV file (one bar per line, exact float values) with a small
JSON file beside it saying what it holds and its SHA-256. Files are written
to a temporary name and then renamed, so a crash can't leave half a file, and
they are never changed afterwards. When a file is read back, its hash must
match; one that doesn't (damaged, or edited by hand) is refused and fetched
again. The database's market_data_metadata table keeps the same hash, as a
second record of what was downloaded.

Only complete history is cached: a range that includes today could still
change, so it is always fetched afresh.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from .models import AssetClass, Bar, BarSeries, Timeframe

COLUMNS = ("start", "open", "high", "low", "close", "volume", "trade_count", "vwap")
FORMAT_VERSION = 1


class CacheError(Exception):
    """A cached file is damaged or doesn't hold what its name says."""


@dataclass(frozen=True, slots=True)
class CacheKey:
    provider: str
    symbol: str
    asset_class: AssetClass
    timeframe: Timeframe
    feed: str
    adjustment: str
    start: date
    end: date

    @property
    def stem(self) -> str:
        parts = (
            self.provider,
            self.symbol.replace("/", "-"),
            self.timeframe,
            self.feed,
            self.adjustment,
            str(self.start),
            str(self.end),
        )
        return "_".join(parts)

    @classmethod
    def of(cls, series: BarSeries) -> CacheKey:
        return cls(
            provider=series.source,
            symbol=series.symbol,
            asset_class=series.asset_class,
            timeframe=series.timeframe,
            feed=series.feed,
            adjustment=series.adjustment,
            start=series.start,
            end=series.end,
        )


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode(bars: tuple[Bar, ...]) -> bytes:
    """The CSV text of the bars. repr() of a float reads back as exactly the same float."""
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(COLUMNS)
    for bar in bars:
        writer.writerow(
            [
                bar.start.astimezone(UTC).isoformat().replace("+00:00", "Z"),
                repr(bar.open),
                repr(bar.high),
                repr(bar.low),
                repr(bar.close),
                repr(bar.volume),
                "" if bar.trade_count is None else str(bar.trade_count),
                "" if bar.vwap is None else repr(bar.vwap),
            ]
        )
    return out.getvalue().encode("utf-8")


def decode(data: bytes) -> tuple[Bar, ...]:
    rows = list(csv.reader(io.StringIO(data.decode("utf-8"), newline="")))
    if not rows or tuple(rows[0]) != COLUMNS:
        raise CacheError("the file doesn't start with the expected columns")
    bars = []
    for number, row in enumerate(rows[1:], start=2):
        if len(row) != len(COLUMNS):
            raise CacheError(f"line {number} has {len(row)} values, not {len(COLUMNS)}")
        try:
            start = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
            bars.append(
                Bar(
                    start=start,
                    open=float(row[1]),
                    high=float(row[2]),
                    low=float(row[3]),
                    close=float(row[4]),
                    volume=float(row[5]),
                    trade_count=int(row[6]) if row[6] else None,
                    vwap=float(row[7]) if row[7] else None,
                )
            )
        except ValueError as exc:
            raise CacheError(f"line {number} can't be read: {exc}") from None
    return tuple(bars)


@dataclass(frozen=True, slots=True)
class CachedFile:
    path: Path
    sha256: str
    bar_count: int


class BarCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def paths_for(self, key: CacheKey) -> tuple[Path, Path]:
        """The bars file and the JSON file that describes it."""
        return self.directory / f"{key.stem}.csv", self.directory / f"{key.stem}.meta.json"

    def save(self, series: BarSeries, *, fetched_at: datetime) -> CachedFile:
        data = encode(series.bars)
        digest = sha256_of(data)
        key = CacheKey.of(series)
        bars_path, meta_path = self.paths_for(key)
        meta = {
            "format": FORMAT_VERSION,
            "provider": key.provider,
            "symbol": key.symbol,
            "asset_class": key.asset_class,
            "timeframe": key.timeframe,
            "feed": key.feed,
            "adjustment": key.adjustment,
            "start": key.start.isoformat(),
            "end": key.end.isoformat(),
            "bar_count": len(series.bars),
            "sha256": digest,
            "fetched_at": fetched_at.astimezone(UTC).isoformat(),
        }
        self.directory.mkdir(parents=True, exist_ok=True)
        _write_atomically(bars_path, data)
        _write_atomically(meta_path, (json.dumps(meta, indent=2) + "\n").encode("utf-8"))
        return CachedFile(bars_path, digest, len(series.bars))

    def load(
        self, key: CacheKey, *, expected_sha256: str | None = None
    ) -> tuple[BarSeries, CachedFile] | None:
        """The cached series and its file, or None when there is none. Raises
        CacheError when the file is damaged, doesn't match its description, or
        doesn't match the hash recorded elsewhere (`expected_sha256`)."""
        bars_path, meta_path = self.paths_for(key)
        if not bars_path.is_file():
            return None
        data = bars_path.read_bytes()
        digest = sha256_of(data)
        meta = self._meta(meta_path)
        if meta.get("sha256") != digest:
            raise CacheError(f"{bars_path.name} doesn't match the hash in {meta_path.name}")
        if expected_sha256 is not None and expected_sha256 != digest:
            raise CacheError(f"{bars_path.name} doesn't match the hash recorded in the database")
        described = (
            meta.get("symbol"),
            meta.get("timeframe"),
            meta.get("start"),
            meta.get("end"),
            meta.get("feed"),
            meta.get("adjustment"),
        )
        wanted = (
            key.symbol,
            key.timeframe,
            key.start.isoformat(),
            key.end.isoformat(),
            key.feed,
            key.adjustment,
        )
        if described != wanted:
            raise CacheError(f"{meta_path.name} describes different data from its name")
        bars = decode(data)
        if meta.get("bar_count") != len(bars):
            raise CacheError(
                f"{bars_path.name} holds {len(bars)} bars, not {meta.get('bar_count')}"
            )
        series = BarSeries(
            symbol=key.symbol,
            asset_class=key.asset_class,
            timeframe=key.timeframe,
            bars=bars,
            start=key.start,
            end=key.end,
            source=key.provider,
            feed=key.feed,
            adjustment=key.adjustment,
        )
        return series, CachedFile(bars_path, digest, len(bars))

    def key_of(self, bars_path: Path) -> CacheKey:
        """The key a cached file was saved under, from the description beside it."""
        meta = self._meta(bars_path.with_name(bars_path.name.removesuffix(".csv") + ".meta.json"))
        try:
            return CacheKey(
                provider=str(meta["provider"]),
                symbol=str(meta["symbol"]),
                asset_class=meta["asset_class"],
                timeframe=meta["timeframe"],
                feed=str(meta["feed"]),
                adjustment=str(meta["adjustment"]),
                start=date.fromisoformat(str(meta["start"])),
                end=date.fromisoformat(str(meta["end"])),
            )
        except (KeyError, ValueError) as exc:
            raise CacheError(f"the description of {bars_path.name} is incomplete: {exc}") from None

    def files(self) -> list[Path]:
        """Every cached bars file."""
        if not self.directory.is_dir():
            return []
        return sorted(self.directory.glob("*.csv"))

    @staticmethod
    def _meta(path: Path) -> dict[str, Any]:
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise CacheError(f"{path.name} can't be read: {exc}") from None
        if not isinstance(meta, dict) or meta.get("format") != FORMAT_VERSION:
            raise CacheError(f"{path.name} isn't a cache description STRATA wrote")
        return meta


def _write_atomically(path: Path, data: bytes) -> None:
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
