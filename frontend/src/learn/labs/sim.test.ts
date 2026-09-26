// The labs' arithmetic, checked by hand.

import { describe, expect, it } from "vitest";

import { rsi } from "../indicators";
import { SELL_SCENARIOS } from "../synthetic";
import {
  crossoverBacktest,
  overfitExperiment,
  overfitSurvey,
  rankAfterwards,
  rsiSteps,
  saleOf,
  simulateSell,
  sizeTrade,
  walkBook,
  walkPipeline,
  type Situation,
} from "./sim";

const LIMITS = {
  MAX_CAPITAL: 300,
  MAX_POSITION_PCT: 20,
  STOP_LOSS_PCT: 5,
  DAILY_LOSS_LIMIT: 15,
  TOTAL_LOSS_LIMIT: 60,
  MAX_TRADES_PER_DAY: 3,
  max_position_value: 60,
};

const scenario = (id: string) => SELL_SCENARIOS.find((s) => s.id === id)!.bars;

describe("buying at market", () => {
  const asks = [
    { price: 100.02, size: 150 },
    { price: 100.01, size: 300 },
    { price: 100.03, size: 200 },
  ];

  it("takes the cheapest shares first", () => {
    const small = walkBook(asks, 100);
    expect(small.fills).toEqual([{ price: 100.01, size: 100 }]);
    expect(small.average).toBeCloseTo(100.01, 10);
    expect(small.slippage).toBeCloseTo(0, 10);
  });

  it("pays more per share as the order eats into higher asks", () => {
    // 300 at 100.01 and 100 at 100.02: (30003 + 10002) / 400 = 100.0125.
    const walk = walkBook(asks, 400);
    expect(walk.fills).toEqual([
      { price: 100.01, size: 300 },
      { price: 100.02, size: 100 },
    ]);
    expect(walk.cost).toBeCloseTo(40005, 6);
    expect(walk.average).toBeCloseTo(100.0125, 10);
    expect(walk.slippage).toBeCloseTo(0.0025, 10);
  });

  it("says when the book runs out", () => {
    const walk = walkBook(asks, 700);
    expect(walk.filled).toBe(650);
    expect(walk.unfilled).toBe(50);
    expect(walkBook(asks, 0).average).toBeNull();
  });
});

describe("one sell order, day by day", () => {
  it("a market order sells at the first open", () => {
    const days = simulateSell({ kind: "market" }, scenario("fall"));
    expect(saleOf(days)).toEqual({ day: 0, price: 100 });
    expect(days.slice(1).every((d) => d.state === "done")).toBe(true);
  });

  it("a stop sells at about the stop when the price falls through it during a day", () => {
    const days = simulateSell({ kind: "stop", stop: 95 }, scenario("fall"));
    // Day 6 (index 5) has a low of 94.30.
    expect(saleOf(days)).toEqual({ day: 5, price: 95 });
    expect(days.slice(0, 5).every((d) => d.state === "waiting")).toBe(true);
  });

  it("a stop sells at the open, below the stop, after a gap", () => {
    const days = simulateSell({ kind: "stop", stop: 95 }, scenario("gap"));
    expect(saleOf(days)).toEqual({ day: 4, price: 91.2 });
    expect(days[4]!.note).toMatch(/below your stop at \$95\.00/);
    expect(days[4]!.note).toMatch(/\$3\.80 a share worse/);
  });

  it("a stop-limit doesn't sell below its limit, even while the price keeps falling", () => {
    const days = simulateSell({ kind: "stop-limit", stop: 95, limit: 94 }, scenario("gap"));
    expect(saleOf(days)).toBeNull();
    expect(days.slice(4).every((d) => d.state === "triggered")).toBe(true);
    expect(days[4]!.note).toMatch(/no sale/);
  });

  it("a stop-limit sells at its limit if the price comes back to it", () => {
    // Day 7 (index 6) opens at 93.00 and reaches 94.60.
    const days = simulateSell({ kind: "stop-limit", stop: 95, limit: 94 }, scenario("bounce"));
    expect(saleOf(days)).toEqual({ day: 6, price: 94 });
  });

  it("a stop-limit whose limit is at or below the stop sells like a stop when the price passes it during a day", () => {
    const days = simulateSell({ kind: "stop-limit", stop: 95, limit: 94 }, scenario("fall"));
    expect(saleOf(days)).toEqual({ day: 5, price: 95 });
  });

  it("a stop-limit whose limit is above the stop can't sell the moment it is triggered", () => {
    const days = simulateSell({ kind: "stop-limit", stop: 95, limit: 96 }, scenario("fall"));
    expect(days[5]!.state).toBe("triggered");
    expect(saleOf(days)).toBeNull();
  });

  it("a limit order sells at the limit when a day's high reaches it, and never below it", () => {
    const rally = simulateSell({ kind: "limit", limit: 110 }, scenario("rally"));
    expect(saleOf(rally)).toEqual({ day: 9, price: 110 });
    // Opening above the limit sells at the (better) open.
    expect(saleOf(simulateSell({ kind: "limit", limit: 99 }, scenario("fall")))).toEqual({ day: 0, price: 100 });
    expect(saleOf(simulateSell({ kind: "limit", limit: 110 }, scenario("fall")))).toBeNull();
  });

  it("a stop that is never reached never sells", () => {
    expect(saleOf(simulateSell({ kind: "stop", stop: 95 }, scenario("rally")))).toBeNull();
  });
});

describe("a crossover, traded", () => {
  // Averages of 2 and 3 days over a dip, a rise, a dip and a rise again.
  //   day        0   1    2    3     4   5     6     7   8    9     10  11
  //   price      10  9    8    9     10  11    10    9   8    9     10  11
  //   2-day      -   9.5  8.5  8.5   9.5 10.5  10.5  9.5 8.5  8.5   9.5 10.5
  //   3-day      -   -    9    8.67  9   10    10.33 10  9    8.67  9   10
  // The 2-day average rises above the 3-day on days 4 and 10, falls below on day 7.
  const prices = [10, 9, 8, 9, 10, 11, 10, 9, 8, 9, 10, 11];

  it("acts on each signal at the next day's close, never at the close that made it", () => {
    const result = crossoverBacktest(prices, 2, 3);
    expect(result.signals.map((s) => [s.index, s.kind])).toEqual([
      [4, "up"],
      [7, "down"],
      [10, "up"],
    ]);
    // Bought on day 5 at 11, sold on day 8 at 8; bought again on day 11, the
    // last day, so still held.
    expect(result.trades).toEqual([
      { buy: 5, sell: 8, buyPrice: 11, sellPrice: 8, returnPct: expect.closeTo((8 / 11 - 1) * 100, 10) },
      { buy: 11, sell: null, buyPrice: 11, sellPrice: 11, returnPct: expect.closeTo(0, 10) },
    ]);
    // Averages lag, and acting a day later lags more: -27% while holding made +10%.
    expect(result.totalPct).toBeCloseTo((8 / 11 - 1) * 100, 10);
    expect(result.buyHoldPct).toBeCloseTo(10, 10);
    expect(result.daysHeld).toBe(3);
    expect(result.winRate).toBe(0);
  });

  it("charges the round-trip cost on every trade", () => {
    const result = crossoverBacktest(prices, 2, 3, 1);
    expect(result.trades[0]!.returnPct).toBeCloseTo((8 / 11) * 0.99 * 100 - 100, 10);
    expect(result.trades[1]!.returnPct).toBeCloseTo(0.99 * 100 - 100, 10);
  });

  it("can't act on a signal on the very last day", () => {
    // The only crossing is on the last day: there is no next day to trade on.
    const result = crossoverBacktest([5, 4, 3, 2, 1, 9], 2, 3);
    expect(result.signals).toEqual([{ index: 5, kind: "up" }]);
    expect(result.trades).toEqual([]);
  });

  it("has no trades, and no win rate, when the averages never cross", () => {
    const result = crossoverBacktest([1, 2, 3, 4, 5, 6, 7], 2, 3);
    expect(result.trades).toEqual([]);
    expect(result.totalPct).toBe(0);
    expect(result.winRate).toBeNull();
  });
});

describe("RSI, step by step", () => {
  it("shows the same numbers as the RSI itself, with the working", () => {
    const prices = [10, 11, 12, 13, 11, 12, 10, 10.5, 11, 9];
    const steps = rsiSteps(prices, 3);
    const values = rsi(prices, 3);
    steps.forEach((step, i) => {
      if (step === null) expect(values[i]).toBeNull();
      else expect(step.rsi).toBeCloseTo(values[i]!, 10);
    });
    // The first RSI is a plain average of the first three changes.
    expect(steps[3]).toMatchObject({ first: true, change: 1, gain: 1, loss: 0, avgGain: 1, avgLoss: 0, rs: null, rsi: 100 });
    // Then Wilder's running average: (1 * 2 + 0) / 3 and (0 * 2 + 2) / 3.
    expect(steps[4]).toMatchObject({ first: false, change: -2, gain: 0, loss: 2, previousAvgGain: 1, previousAvgLoss: 0 });
    expect(steps[4]!.avgGain).toBeCloseTo(2 / 3, 10);
    expect(steps[4]!.avgLoss).toBeCloseTo(2 / 3, 10);
    expect(steps[4]!.rs).toBeCloseTo(1, 10);
    expect(steps[4]!.rsi).toBeCloseTo(50, 10);
  });
});

describe("the overfitting machine", () => {
  it("is repeatable, and tries distinct settings", () => {
    const a = overfitExperiment(3, 40);
    const b = overfitExperiment(3, 40);
    expect(a).toEqual(b);
    expect(new Set(a.runs.map((r) => `${r.fast}/${r.slow}`)).size).toBe(40);
    for (const run of a.runs) expect(run.slow).toBeGreaterThan(run.fast);
  });

  it("picks the best in-sample result, and reports how it did afterwards", () => {
    const experiment = overfitExperiment(5, 60);
    expect(experiment.best.inSamplePct).toBe(Math.max(...experiment.runs.map((r) => r.inSamplePct)));
    expect(experiment.split).toBe(Math.round(experiment.prices.length * 0.6));
  });

  it("ranks the best backtest among all the settings afterwards, and surveys many markets", () => {
    const experiment = overfitExperiment(8, 100);
    const rank = rankAfterwards(experiment);
    expect(rank).toBe(1 + experiment.runs.filter((r) => r.outSamplePct > experiment.best.outSamplePct).length);
    const survey = overfitSurvey([1, 2, 3, 4, 5], 50);
    expect(survey.markets).toBe(5);
    expect(survey.winnerAhead).toBeGreaterThanOrEqual(0);
    expect(survey.winnerAhead).toBeLessThanOrEqual(5);
    expect(survey.worstRank).toBeGreaterThanOrEqual(1);
    expect(survey.worstRank).toBeLessThanOrEqual(50);
  });

  it("on prices with no pattern, the best in-sample results don't carry over", () => {
    // Across many made-up markets, the in-sample winner does no better
    // afterwards than the typical strategy: it was luck.
    let winnerAhead = 0;
    const markets = 30;
    for (let seed = 1; seed <= markets; seed++) {
      const e = overfitExperiment(seed, 50);
      if (e.best.outSamplePct > e.medianOutPct) winnerAhead++;
    }
    expect(winnerAhead).toBeGreaterThan(markets * 0.2);
    expect(winnerAhead).toBeLessThan(markets * 0.8);
  });
});

describe("how much one trade can cost", () => {
  it("works out STRATA's shipped numbers", () => {
    // $300 * 20% = $60; 5% of $60 = $3 = 1% of $300; $15 / $3 = 5; $60 / $3 = 20.
    expect(sizeTrade(300, 20, 5, 15, 60)).toEqual({ position: 60, lossAtStop: 3, lossPct: 1, dailyAllows: 5, totalAllows: 20 });
  });

  it("counts whole stop-outs, like the Risk limits page", () => {
    expect(sizeTrade(300, 20, 7, 15, 60).dailyAllows).toBe(3); // $4.20 each: 3 make $12.60, a 4th passes $15
    expect(sizeTrade(300, 20, 0, 15, 60).dailyAllows).toBeNull();
  });
});

describe("one trade idea through the pipeline", () => {
  const ok: Situation = {
    side: "buy",
    dataFresh: true,
    strategySignals: true,
    criticObjects: false,
    killSwitch: false,
    dailyLossReached: false,
    tradesToday: 0,
    positionPct: 20,
  };
  const stopsAt = (s: Situation) => walkPipeline(s, LIMITS).find((stage) => stage.outcome === "stop")?.name ?? null;

  it("a good idea goes all the way to the broker", () => {
    const stages = walkPipeline(ok, LIMITS);
    expect(stages.every((stage) => stage.outcome === "pass")).toBe(true);
    expect(stages.at(-1)!.name).toBe("Broker");
  });

  it("stops at the first problem, and nothing after it runs", () => {
    const stages = walkPipeline({ ...ok, dataFresh: false }, LIMITS);
    expect(stages[0]!.outcome).toBe("stop");
    expect(stages.slice(1).every((stage) => stage.outcome === "not reached")).toBe(true);
  });

  it("refuses buys that break a limit", () => {
    expect(stopsAt({ ...ok, strategySignals: false })).toBe("Strategy and agents");
    expect(stopsAt({ ...ok, criticObjects: true })).toBe("Critic");
    expect(stopsAt({ ...ok, killSwitch: true })).toBe("Risk engine: kill switch");
    expect(stopsAt({ ...ok, dailyLossReached: true })).toBe("Risk engine: daily loss limit");
    expect(stopsAt({ ...ok, tradesToday: 3 })).toBe("Risk engine: trades per day");
    expect(stopsAt({ ...ok, positionPct: 30 })).toBe("Risk engine: position size");
  });

  it("lets sells that only reduce risk through the limits (decision Q2), but not past the kill switch or stale data", () => {
    const sell: Situation = { ...ok, side: "sell", criticObjects: true, dailyLossReached: true, tradesToday: 3, positionPct: 30 };
    expect(stopsAt(sell)).toBeNull();
    expect(stopsAt({ ...sell, killSwitch: true })).toBe("Risk engine: kill switch");
    expect(stopsAt({ ...sell, dataFresh: false })).toBe("Market data");
  });
});
