import { describe, expect, it } from "vitest";

import { crossovers, drawdown, longOnly, recoveryNeeded, rsi, rsiSignals, sma } from "./indicators";
import { EQUITY, pricePath, RANGING, seeded, TRENDING, TRENDING_SIDEWAYS_FROM } from "./synthetic";

describe("indicators", () => {
  it("sma averages the last n values", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("rsi matches Wilder's definition", () => {
    // Steady rises: no losses, so RSI is 100.
    expect(rsi([1, 2, 3, 4, 5, 6], 3).slice(3)).toEqual([100, 100, 100]);
    // Alternating +1/-1: gains and losses balance, so RSI swings just either
    // side of 50 (above after a rise, below after a fall).
    const zigzag = Array.from({ length: 40 }, (_, i) => (i % 2 ? 11 : 10));
    const [afterFall, afterRise] = rsi(zigzag, 14).slice(38) as number[];
    expect(afterRise).toBeGreaterThan(50);
    expect(afterFall).toBeLessThan(50);
    expect((afterRise! + afterFall!) / 2).toBeCloseTo(50, 0);
    // A worked example: 3 gains of 1 then a loss of 2, period 3.
    // First averages (changes +1,+1,+1): gain 1, loss 0 -> 100.
    // Next change -2: gain (1*2+0)/3 = 2/3, loss (0*2+2)/3 = 2/3 -> RSI 50.
    const worked = rsi([10, 11, 12, 13, 11], 3);
    expect(worked[3]).toBe(100);
    expect(worked[4]).toBeCloseTo(50, 10);
    expect(worked.slice(0, 3)).toEqual([null, null, null]);
  });

  it("finds where one average crosses another", () => {
    expect(crossovers([1, 2, 3, 2, 1], [2, 2, 2, 2, 2])).toEqual([
      { index: 2, kind: "up" },
      { index: 4, kind: "down" },
    ]);
    expect(crossovers([null, 3], [2, 2])).toEqual([]);
  });

  it("acts only on crossings that change a long-only position", () => {
    // A fall below while holding nothing is not a sell: there is nothing to sell.
    expect(
      longOnly([
        { index: 3, kind: "down" },
        { index: 5, kind: "up" },
        { index: 8, kind: "down" },
        { index: 9, kind: "up" },
      ]),
    ).toEqual([
      { index: 5, kind: "up" },
      { index: 8, kind: "down" },
      { index: 9, kind: "up" },
    ]);
  });

  it("measures drawdown from the running peak", () => {
    expect(drawdown([100, 110, 99, 121])).toEqual([0, 0, -10, 0]);
  });

  it("knows losses need bigger gains to recover", () => {
    expect(recoveryNeeded(50)).toBe(100);
    expect(recoveryNeeded(20)).toBe(25);
    expect(recoveryNeeded(5)).toBeCloseTo(5.263, 3);
    expect(recoveryNeeded(100)).toBe(Infinity);
  });

  it("turns RSI into buy-low, sell-high signals, one position at a time", () => {
    expect(rsiSignals([50, 25, 20, 60, 75, 80, 28], 30, 70)).toEqual([
      { index: 1, kind: "up" },
      { index: 4, kind: "down" },
      { index: 6, kind: "up" },
    ]);
  });
});

describe("made-up prices", () => {
  it("are repeatable", () => {
    expect(seeded(1)()).toBe(seeded(1)());
    expect(pricePath(100, [{ days: 5, drift: 0, volatility: 0.01 }], 4)).toEqual(
      pricePath(100, [{ days: 5, drift: 0, volatility: 0.01 }], 4),
    );
  });

  it("show what each illustration needs", () => {
    // The crossover picture's story, at STRATA's shipped 20/50 and at nearby
    // settings: in cash when the averages start, a late buy in the long rise
    // (days 60 to 135), a late sell in the long fall (days 155 to 210), and at
    // least one whipsaw in the sideways stretch after it.
    for (const [f, s] of [[20, 50], [10, 30], [15, 40]] as const) {
      const fast = sma(TRENDING, f);
      const slow = sma(TRENDING, s);
      expect(fast[s - 1]!).toBeLessThan(slow[s - 1]!);
      const [buy, sell, ...rest] = longOnly(crossovers(fast, slow));
      expect(buy).toMatchObject({ kind: "up" });
      expect(buy!.index).toBeGreaterThan(60);
      expect(buy!.index).toBeLessThan(135);
      expect(sell).toMatchObject({ kind: "down" });
      expect(sell!.index).toBeGreaterThan(155);
      expect(sell!.index).toBeLessThan(TRENDING_SIDEWAYS_FROM);
      expect(rest.length).toBeGreaterThanOrEqual(2);
      expect(rest.every((signal) => signal.index >= TRENDING_SIDEWAYS_FROM)).toBe(true);
    }
    const signals = rsiSignals(rsi(RANGING, 14), 30, 70);
    expect(signals.filter((s) => s.kind === "up").length).toBeGreaterThanOrEqual(2);
    expect(signals.filter((s) => s.kind === "down").length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...drawdown(EQUITY))).toBeLessThan(-8);
  });
});
