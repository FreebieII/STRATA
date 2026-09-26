import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { roundTrip } from "../lib/costs";
import { auditStats, eventStats, healthHistory } from "../test/fakeApi";
import { ColumnChart, ColumnTable } from "./ColumnChart";
import { CostBars } from "./CostBars";
import { HealthTable, slotState, UptimeStrips } from "./HealthCharts";
import { RankBars } from "./RankBars";
import { columnPath, labelEvery, niceTicks } from "./scale";
import {
  auditColumns,
  dayLabels,
  eventColumns,
  parsePeriod,
  periodStart,
  SEVERITY_SERIES,
  signInColumns,
} from "./series";

describe("scales", () => {
  it("picks round ticks", () => {
    expect(niceTicks(7, 4, true)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(23, 4, true)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(0, 4, true)).toEqual([0, 1]);
    expect(niceTicks(0.9, 3)).toEqual([0, 0.5, 1]);
    expect(niceTicks(1, 4, true)).toEqual([0, 1]);
  });

  it("thins labels so they fit", () => {
    expect(labelEvery(14, 20)).toBe(1);
    expect(labelEvery(30, 10)).toBe(3);
    expect(labelEvery(90, 0)).toBe(90);
  });

  it("draws columns square at the baseline and rounded at the top", () => {
    const path = columnPath(10, 20, 24, 100);
    expect(path.startsWith("M10,120V24")).toBe(true); // straight up from the baseline
    expect(path).toContain("Q10,20 14,20"); // a 4 px curve at the top
    expect(columnPath(0, 0, 4, 1)).toContain("V1"); // never a radius taller than the bar
  });
});

describe("chart data", () => {
  it("keeps calendar days on their own date in every time zone", () => {
    const { label, longLabel } = dayLabels("2026-09-26");
    expect(label).toMatch(/26/);
    expect(longLabel).toMatch(/2026/);
    expect(longLabel).toMatch(/26/);
  });

  it("reads the period from the address, falling back to a default", () => {
    expect(parsePeriod("30", 14)).toBe(30);
    expect(parsePeriod("31", 14)).toBe(14);
    expect(parsePeriod(null, 7)).toBe(7);
  });

  it("starts a period at local midnight", () => {
    const now = new Date(2026, 8, 26, 15, 30);
    const start = new Date(periodStart(7, now));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 8, 20, 0]);
  });

  it("turns event statistics into one column per day", () => {
    const columns = eventColumns(eventStats(3, [{}, { warning: 2 }, { info: 5, error: 1 }]));
    expect(columns.map((c) => c.key)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(columns[2]!.values).toMatchObject({ info: 5, error: 1, warning: 0 });
  });

  it("groups audit actions into logins, logouts and the rest", () => {
    const columns = auditColumns(auditStats(1, [{ login: 3, logout: 1, operator_created: 1, db_upgrade: 2 }]));
    expect(columns[0]!.values).toEqual({ login: 3, logout: 1, other: 3 });
  });

  it("puts successful and failed sign-ins side by side", () => {
    const columns = signInColumns(auditStats(2, [{ login: 1 }, { login: 2 }]), eventStats(2, [{}, { warning: 4 }]));
    expect(columns.map((c) => c.values)).toEqual([
      { ok: 1, failed: 0 },
      { ok: 2, failed: 4 },
    ]);
  });
});

describe("ColumnChart", () => {
  const columns = eventColumns(eventStats(3, [{ info: 2 }, {}, { warning: 1, info: 3 }]));

  it("draws one mark per non-zero part", () => {
    const { container } = render(
      <ColumnChart series={SEVERITY_SERIES} columns={columns} label="Events" noun="events" />,
    );
    // Day 1: info. Day 3: warning and info stacked. Day 2 has nothing.
    expect(container.querySelectorAll("path")).toHaveLength(3);
  });

  it("shows every series' value for a day, by keyboard too", () => {
    render(<ColumnChart series={SEVERITY_SERIES} columns={columns} label="Events" noun="events" />);
    const chart = screen.getByRole("img", { name: /Events/ });
    fireEvent.keyDown(chart, { key: "End" });
    const tip = screen.getByRole("status");
    expect(within(tip).getByText("4")).toBeInTheDocument(); // the total
    expect(within(tip).getByText("events in all")).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says so when the period is empty", () => {
    render(<ColumnChart series={SEVERITY_SERIES} columns={eventColumns(eventStats(3))} label="E" noun="events" />);
    expect(screen.getByText("Nothing recorded in this period")).toBeInTheDocument();
  });

  it("has a table with the same numbers", () => {
    render(<ColumnTable series={SEVERITY_SERIES} columns={columns} caption="Events per day" />);
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3 days, newest first
    expect(within(rows[1]!).getAllByRole("cell").at(-1)).toHaveTextContent("4");
  });
});

describe("RankBars", () => {
  it("offers each name as a filter when asked", async () => {
    const pick = vi.fn();
    render(
      <RankBars
        items={[
          { name: "login_failed", value: 9 },
          { name: "api_started", value: 2 },
        ]}
        label="Types"
        onPick={pick}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Show only login_failed" }));
    expect(pick).toHaveBeenCalledWith("login_failed");
    expect(screen.getByText("9")).toBeInTheDocument();
  });
});

describe("health charts", () => {
  it("names each slot's state", () => {
    const point = { start: "", latency_avg_ms: null, latency_max_ms: null };
    expect(slotState({ ...point, samples: 0, failed: 0 })).toBe("none");
    expect(slotState({ ...point, samples: 4, failed: 0 })).toBe("good");
    expect(slotState({ ...point, samples: 4, failed: 1 })).toBe("partial");
    expect(slotState({ ...point, samples: 4, failed: 4 })).toBe("failed");
  });

  it("shows availability and reads a slot out", () => {
    const history = healthHistory("1h");
    render(<UptimeStrips series={history.series} bucketS={60} active={58} onActive={() => undefined} />);
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/Database: every reading failed · Redis: every reading passed/)).toBeInTheDocument();
  });

  it("lists only slots with readings in the table", () => {
    const history = healthHistory("1h");
    render(<HealthTable series={history.series} bucketS={60} />);
    expect(screen.getAllByRole("row")).toHaveLength(1 + 5);
    expect(screen.getByText("4 of 4 failed")).toBeInTheDocument();
  });
});

describe("costs", () => {
  it("works out a round trip from the cost settings", () => {
    const stock = roundTrip({ fee_pct: 0, fee_per_sell_usd: 0.02, slippage_pct: 0.05 }, 60);
    const crypto = roundTrip({ fee_pct: 0.25, fee_per_sell_usd: 0, slippage_pct: 0.15 }, 60);
    expect(stock.total).toBeCloseTo(0.08);
    expect(crypto.fees).toBeCloseTo(0.3);
    expect(crypto.slippage).toBeCloseTo(0.18);
    expect(crypto.breakevenPct).toBeCloseTo(0.8);
    render(<CostBars rows={[{ label: "Crypto", cost: crypto }]} />);
    expect(screen.getByText("$0.48")).toBeInTheDocument();
    expect(screen.getByText("(0.80%)")).toBeInTheDocument();
  });
});
