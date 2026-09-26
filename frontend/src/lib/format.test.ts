import { describe, expect, it } from "vitest";

import {
  formatAgo,
  formatDuration,
  formatMs,
  formatPct,
  formatTime,
  formatUsd,
  formatUtc,
  humanise,
  shortCommit,
} from "./format";

describe("formatting", () => {
  it("money shows cents only when there are some", () => {
    expect(formatUsd(300)).toBe("$300");
    expect(formatUsd(2.5)).toBe("$2.50");
    expect(formatUsd(1234)).toBe("$1,234");
  });

  it("percentages", () => {
    expect(formatPct(20)).toBe("20%");
    expect(formatPct(2.5)).toBe("2.5%");
  });

  it("milliseconds keep useful precision", () => {
    expect(formatMs(0.42)).toBe("0.42 ms");
    expect(formatMs(1.84)).toBe("1.8 ms");
    expect(formatMs(24.4)).toBe("24 ms");
  });

  it("durations use the two largest units", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(725)).toBe("12m 5s");
    expect(formatDuration(3725)).toBe("1h 2m");
    expect(formatDuration(2 * 86_400 + 4 * 3_600 + 99)).toBe("2d 4h");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("relative times", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    expect(formatAgo("2026-09-25T11:59:55Z", now)).toBe("just now");
    expect(formatAgo("2026-09-25T11:59:30Z", now)).toBe("30 s ago");
    expect(formatAgo("2026-09-25T11:55:00Z", now)).toBe("5 min ago");
    expect(formatAgo("2026-09-25T09:00:00Z", now)).toBe("3 h ago");
    expect(formatAgo("2026-09-20T12:00:00Z", now)).toBe("5 days ago");
  });

  it("times use a 24-hour clock, and UTC is exact", () => {
    expect(formatTime("2026-09-25T20:05:09Z")).toMatch(/\d{2}:05:09/);
    expect(formatTime("2026-09-25T20:05:09Z")).not.toMatch(/AM|PM/);
    expect(formatUtc("2026-09-25T20:05:09.123Z")).toBe("2026-09-25 20:05:09 UTC");
  });

  it("names read as words", () => {
    expect(humanise("asset_class")).toBe("Asset class");
    expect(humanise("database")).toBe("Database");
    expect(shortCommit("c73ab5149bd9")).toBe("c73ab51");
    expect(shortCommit(null)).toBeNull();
  });
});
