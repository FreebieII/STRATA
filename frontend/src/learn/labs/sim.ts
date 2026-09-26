// The arithmetic behind the Learn section's labs. Every function is pure and
// small enough to check by hand, and sim.test.ts does. The labs only draw what
// these return.

import type { RiskLimitsSummary } from "../../api/types";
import { crossovers, longOnly, sma, type Cross } from "../indicators";
import { pricePath, seeded } from "../synthetic";

// --- buying at market against the order book ----------------------------------------------

export type Level = { price: number; size: number };

export type BookWalk = {
  fills: Level[];
  filled: number;
  // Shares the book couldn't supply.
  unfilled: number;
  cost: number;
  average: number | null;
  // How much more than the best ask each share cost, on average.
  slippage: number | null;
};

/** Buy `quantity` shares at market: take the cheapest asks first. */
export function walkBook(asks: Level[], quantity: number): BookWalk {
  const book = [...asks].sort((a, b) => a.price - b.price);
  const fills: Level[] = [];
  let left = Math.max(0, quantity);
  let cost = 0;
  for (const level of book) {
    if (left <= 0) break;
    const size = Math.min(left, level.size);
    fills.push({ price: level.price, size });
    cost += size * level.price;
    left -= size;
  }
  const filled = Math.max(0, quantity) - left;
  const average = filled ? cost / filled : null;
  const best = book[0]?.price;
  return {
    fills,
    filled,
    unfilled: left,
    cost,
    average,
    slippage: average === null || best === undefined ? null : average - best,
  };
}

// --- one sell order, day by day ----------------------------------------------------------------

export type Bar = { open: number; high: number; low: number; close: number };

export type SellOrder =
  | { kind: "market" }
  | { kind: "limit"; limit: number }
  | { kind: "stop"; stop: number }
  | { kind: "stop-limit"; stop: number; limit: number };

export type DayStatus = {
  day: number;
  state: "waiting" | "triggered" | "sold" | "done";
  // The sale price, on the day of the sale.
  price: number | null;
  note: string;
};

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Follow a sell order through daily bars with simple rules: any price inside a
 * day's range could be reached; the jump between one day's close and the next
 * day's open (a gap) can't be traded in. Real orders fill trade by trade, and
 * in a fast market a stop can fill well below its price.
 */
export function simulateSell(order: SellOrder, bars: Bar[]): DayStatus[] {
  const days: DayStatus[] = [];
  let sold = false;
  // A stop or stop-limit waits for its stop price before it does anything.
  let triggered = order.kind === "market" || order.kind === "limit";

  bars.forEach((bar, day) => {
    const push = (state: DayStatus["state"], note: string, price: number | null = null) => {
      if (state === "sold") sold = true;
      days.push({ day, state, price, note });
    };
    if (sold) return push("done", "Already sold.");
    if (order.kind === "market") {
      return push("sold", `A market order sells at the first price there is: the open, ${usd(bar.open)}.`, bar.open);
    }

    if (!triggered && (order.kind === "stop" || order.kind === "stop-limit")) {
      const stop = order.stop;
      if (bar.open > stop && bar.low > stop) {
        return push("waiting", `Low ${usd(bar.low)}: still above your stop at ${usd(stop)}. Nothing happens.`);
      }
      triggered = true;
      const gapped = bar.open <= stop;
      if (order.kind === "stop") {
        return gapped
          ? push(
              "sold",
              `It opened at ${usd(bar.open)}, below your stop at ${usd(stop)}: the stop became a market order and sold at the open, ${usd(stop - bar.open)} a share worse than the stop.`,
              bar.open,
            )
          : push(
              "sold",
              `It fell to ${usd(bar.low)} during the day, through your stop at ${usd(stop)}: the stop became a market order and sold at about ${usd(stop)}.`,
              stop,
            );
      }
      const limit = order.limit;
      if (!gapped) {
        // The price passed the stop during the day; the new limit order can
        // sell there only if the limit is at or below it.
        return limit <= stop
          ? push(
              "sold",
              `It fell through your stop at ${usd(stop)} during the day: the order became a limit order at ${usd(limit)} and sold at about ${usd(stop)}.`,
              stop,
            )
          : push(
              "triggered",
              `It fell through your stop at ${usd(stop)}: the order became a limit order at ${usd(limit)}, above the price, so it waits.`,
            );
      }
      // Gapped below the stop: the limit order starts at the open.
      if (bar.open >= limit) {
        return push(
          "sold",
          `It opened at ${usd(bar.open)}, below your stop at ${usd(stop)}: the order became a limit order at ${usd(limit)}, and the open is above that, so it sold at the open.`,
          bar.open,
        );
      }
      if (bar.high >= limit) {
        return push(
          "sold",
          `It opened at ${usd(bar.open)}, below your stop and your limit of ${usd(limit)}, then climbed back to ${usd(bar.high)}: sold at your limit, ${usd(limit)}.`,
          limit,
        );
      }
      return push(
        "triggered",
        `It opened at ${usd(bar.open)}, below your stop at ${usd(stop)} and below your limit of ${usd(limit)}: no sale. The order waits for ${usd(limit)}, and the price may keep falling.`,
      );
    }

    // A limit order, or a stop-limit triggered on an earlier day: sell at the
    // limit or better.
    const limit = order.kind === "limit" || order.kind === "stop-limit" ? order.limit : null;
    if (limit === null) return push("waiting", "Waiting.");
    if (bar.open >= limit) {
      return push("sold", `It opened at ${usd(bar.open)}, at or above your limit of ${usd(limit)}: sold at the open.`, bar.open);
    }
    if (bar.high >= limit) {
      return push("sold", `It rose to ${usd(bar.high)} during the day: sold at your limit, ${usd(limit)}.`, limit);
    }
    return order.kind === "stop-limit"
      ? push("triggered", `High ${usd(bar.high)}: still below your limit of ${usd(limit)}. No sale, and the price may keep falling.`)
      : push("waiting", `High ${usd(bar.high)}: below your limit of ${usd(limit)}. The order waits.`);
  });
  return days;
}

/** The first sale, if any. */
export function saleOf(days: DayStatus[]): { day: number; price: number } | null {
  const sale = days.find((d) => d.state === "sold");
  return sale && sale.price !== null ? { day: sale.day, price: sale.price } : null;
}

// --- a moving-average crossover, traded ----------------------------------------------------------

export type Trade = {
  buy: number;
  // null: still held at the end, valued at the last price.
  sell: number | null;
  buyPrice: number;
  sellPrice: number;
  // After the round-trip cost.
  returnPct: number;
};

export type CrossoverResult = {
  fastLine: (number | null)[];
  slowLine: (number | null)[];
  signals: Cross[];
  trades: Trade[];
  totalPct: number;
  buyHoldPct: number;
  daysHeld: number;
  // Share of finished trades that made money; null with none finished.
  winRate: number | null;
};

/**
 * Trade a long-only crossover. A signal needs a day's close, so it is acted on
 * at the next day's close: buy the day after the fast average rises above the
 * slow one, sell the day after it falls back below. (Trading at the same close
 * would be look-ahead bias.) Each trade pays `roundTripCostPct`, the fees and
 * slippage of both ways.
 */
export function crossoverBacktest(prices: number[], fast: number, slow: number, roundTripCostPct = 0): CrossoverResult {
  const fastLine = sma(prices, fast);
  const slowLine = sma(prices, slow);
  const signals = longOnly(crossovers(fastLine, slowLine));
  const last = prices.length - 1;
  const trades: Trade[] = [];
  for (let i = 0; i < signals.length; i += 2) {
    const buy = signals[i]!.index + 1;
    if (buy > last) break;
    const exit = signals[i + 1];
    const sellDay = exit ? exit.index + 1 : null;
    const sold = sellDay !== null && sellDay <= last;
    const sell = sold ? sellDay : last;
    const gross = prices[sell]! / prices[buy]!;
    trades.push({
      buy,
      sell: sold ? sell : null,
      buyPrice: prices[buy]!,
      sellPrice: prices[sell]!,
      returnPct: (gross * (1 - roundTripCostPct / 100) - 1) * 100,
    });
  }
  const finished = trades.filter((t) => t.sell !== null);
  return {
    fastLine,
    slowLine,
    signals,
    trades,
    totalPct: (trades.reduce((acc, t) => acc * (1 + t.returnPct / 100), 1) - 1) * 100,
    buyHoldPct: prices.length ? (prices[last]! / prices[0]! - 1) * 100 : 0,
    daysHeld: trades.reduce((sum, t) => sum + (t.sell ?? last) - t.buy, 0),
    winRate: finished.length ? finished.filter((t) => t.returnPct > 0).length / finished.length : null,
  };
}

// --- RSI, one day at a time ----------------------------------------------------------------------

export type RsiStep = {
  index: number;
  // The first RSI day: its averages are plain averages of the first `period`
  // changes. After it, each day uses Wilder's running average.
  first: boolean;
  change: number;
  gain: number;
  loss: number;
  previousAvgGain: number | null;
  previousAvgLoss: number | null;
  avgGain: number;
  avgLoss: number;
  // Average gain / average loss; null when there were no losses (RSI 100).
  rs: number | null;
  rsi: number;
};

/** The RSI of `values` with every intermediate number, for showing the working. */
export function rsiSteps(values: number[], period = 14): (RsiStep | null)[] {
  const steps: (RsiStep | null)[] = values.map(() => null);
  if (values.length <= period) return steps;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  const step = (index: number, first: boolean, previousAvgGain: number | null, previousAvgLoss: number | null): RsiStep => {
    const change = values[index]! - values[index - 1]!;
    return {
      index,
      first,
      change,
      gain: Math.max(change, 0),
      loss: Math.max(-change, 0),
      previousAvgGain,
      previousAvgLoss,
      avgGain,
      avgLoss,
      rs: avgLoss === 0 ? null : avgGain / avgLoss,
      rsi: avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss),
    };
  };
  steps[period] = step(period, true, null, null);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const before = [avgGain, avgLoss] as const;
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    steps[i] = step(i, false, before[0], before[1]);
  }
  return steps;
}

// --- the overfitting machine ---------------------------------------------------------------------

export type OverfitRun = { fast: number; slow: number; inSamplePct: number; outSamplePct: number };

export type OverfitExperiment = {
  prices: number[];
  // The first day of the out-of-sample period.
  split: number;
  runs: OverfitRun[];
  best: OverfitRun;
  // The median out-of-sample return of all the strategies tried.
  medianOutPct: number;
};

/** Held at each day's close? A signal is acted on at the next day's close. */
function holdings(prices: number[], fast: number, slow: number): boolean[] {
  const held = prices.map(() => false);
  const signals = longOnly(crossovers(sma(prices, fast), sma(prices, slow)));
  let holding = false;
  let next = 0;
  for (let day = 0; day < prices.length; day++) {
    while (next < signals.length && signals[next]!.index === day - 1) {
      holding = signals[next]!.kind === "up";
      next++;
    }
    held[day] = holding;
  }
  return held;
}

/** The strategy's return from the close of day `from` to the close of day `to`, after costs. */
function periodReturn(prices: number[], held: boolean[], from: number, to: number, roundTripCostPct: number): number {
  let value = 1;
  const oneWay = roundTripCostPct / 2 / 100;
  for (let day = from + 1; day <= to; day++) {
    if (held[day - 1]) value *= prices[day]! / prices[day - 1]!;
    if (held[day] !== held[day - 1]) value *= 1 - oneWay;
  }
  return (value - 1) * 100;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Try `count` random crossover settings on prices that have no pattern at all
 * (a random walk with no drift), choose the one with the best in-sample
 * result, and see how it does on the part it never saw.
 */
export function overfitExperiment(seed: number, count = 100, days = 600, inSampleShare = 0.6, roundTripCostPct = 0): OverfitExperiment {
  const prices = pricePath(100, [{ days, drift: 0, volatility: 0.012 }], seed);
  const split = Math.round(prices.length * inSampleShare);
  const random = seeded(seed * 7919 + 1);
  const seen = new Set<string>();
  const runs: OverfitRun[] = [];
  while (runs.length < count) {
    const fast = 2 + Math.floor(random() * 39);
    const slow = fast + 3 + Math.floor(random() * 110);
    const key = `${fast}/${slow}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const held = holdings(prices, fast, slow);
    runs.push({
      fast,
      slow,
      inSamplePct: periodReturn(prices, held, 0, split, roundTripCostPct),
      outSamplePct: periodReturn(prices, held, split, prices.length - 1, roundTripCostPct),
    });
  }
  const best = runs.reduce((a, b) => (b.inSamplePct > a.inSamplePct ? b : a));
  return { prices, split, runs, best, medianOutPct: median(runs.map((r) => r.outSamplePct)) };
}

/** Where the best backtest ranked afterwards among all the settings tried (1 = best). */
export function rankAfterwards(experiment: OverfitExperiment): number {
  const { best, runs } = experiment;
  return 1 + runs.filter((r) => r.outSamplePct > best.outSamplePct).length;
}

/**
 * Run the experiment on many made-up markets: how often did the best backtest
 * beat a typical setting afterwards, and how low did it rank? Luck alone would
 * have it ahead about half the time.
 */
export function overfitSurvey(markets: number[], count = 100): { markets: number; winnerAhead: number; worstRank: number } {
  let winnerAhead = 0;
  let worstRank = 1;
  for (const seed of markets) {
    const experiment = overfitExperiment(seed, count);
    if (experiment.best.outSamplePct > experiment.medianOutPct) winnerAhead++;
    worstRank = Math.max(worstRank, rankAfterwards(experiment));
  }
  return { markets: markets.length, winnerAhead, worstRank };
}

// --- how much one trade can cost -------------------------------------------------------------------

export type Sizing = {
  position: number;
  lossAtStop: number;
  // The loss at the stop, as a share of the capital.
  lossPct: number;
  // How many whole stop-outs fit inside each limit, as on the Risk limits
  // page; null when a stop-out costs nothing.
  dailyAllows: number | null;
  totalAllows: number | null;
};

export function sizeTrade(capital: number, maxPositionPct: number, stopPct: number, dailyLimit: number, totalLimit: number): Sizing {
  const position = (capital * maxPositionPct) / 100;
  const lossAtStop = (position * stopPct) / 100;
  const allows = (limit: number) => (lossAtStop > 0 ? Math.floor(limit / lossAtStop + 1e-9) : null);
  return {
    position,
    lossAtStop,
    lossPct: capital > 0 ? (lossAtStop / capital) * 100 : 0,
    dailyAllows: allows(dailyLimit),
    totalAllows: allows(totalLimit),
  };
}

// --- one trade idea through STRATA's pipeline -------------------------------------------------------

export type Situation = {
  // "buy" opens a position; "sell" only reduces one (a stop-loss or an exit).
  side: "buy" | "sell";
  dataFresh: boolean;
  strategySignals: boolean;
  criticObjects: boolean;
  killSwitch: boolean;
  dailyLossReached: boolean;
  tradesToday: number;
  // The buy's size as a share of MAX_CAPITAL.
  positionPct: number;
};

export type Stage = {
  name: string;
  outcome: "pass" | "stop" | "not reached";
  reason: string;
};

/**
 * The rules decided for STRATA (BUILD_PLAN.md: the brief, D13 and the
 * operator's decisions Q2 and Q3), applied to one pretend trade idea. The
 * real parts arrive in Phases 2 to 8; this only walks through the design.
 */
export function walkPipeline(s: Situation, limits: RiskLimitsSummary): Stage[] {
  const stages: Stage[] = [];
  let stopped = false;
  const step = (name: string, ok: boolean, pass: string, stop: string) => {
    if (stopped) {
      stages.push({ name, outcome: "not reached", reason: "Not reached: an earlier step stopped the idea." });
      return;
    }
    stages.push({ name, outcome: ok ? "pass" : "stop", reason: ok ? pass : stop });
    if (!ok) stopped = true;
  };
  const buying = s.side === "buy";

  step(
    "Market data",
    s.dataFresh,
    "Prices are recent and pass the checks for gaps and bad values.",
    "The data is stale or failed its checks: STRATA sends no new orders until it knows what is going on. (A stop order already waiting at the broker would still work there.)",
  );
  step(
    "Strategy and agents",
    s.strategySignals,
    buying ? "The strategy's rule says buy, and the agents report their views." : "The rules say sell: a signal to exit, or the price reached the stop.",
    "No signal: nothing to do, which is the usual answer.",
  );
  step(
    "Critic",
    !s.criticObjects || !buying,
    buying
      ? "The critic finds no reason to stay out."
      : s.criticObjects
        ? "The critic objects, but sells that only reduce risk always go through (decision Q2)."
        : "The critic has no objection.",
    "The critic objects (for example: the market regime doesn't suit the strategy). The supervisor won't propose the trade.",
  );
  step(
    "Supervisor",
    true,
    "Weighs the views and writes one structured proposal: what, how much, why, with its stop and target.",
    "",
  );
  step(
    "Risk engine: kill switch",
    !s.killSwitch,
    "The kill switch hasn't tripped.",
    "The kill switch has tripped: it already cancelled orders and closed positions, and STRATA refuses to trade until the operator resets it by hand.",
  );
  step(
    "Risk engine: daily loss limit",
    !s.dailyLossReached || !buying,
    s.dailyLossReached ? "The daily loss limit is reached, but this sell only reduces risk, so it goes through (decision Q2), and is logged." : "Today's losses are within the daily limit.",
    `Today's losses reached $${limits.DAILY_LOSS_LIMIT}: no new buys until the day ends.`,
  );
  step(
    "Risk engine: trades per day",
    s.tradesToday < limits.MAX_TRADES_PER_DAY || !buying,
    s.tradesToday >= limits.MAX_TRADES_PER_DAY
      ? `${s.tradesToday} trades today, the limit, but a sell that only reduces risk still goes through (decision Q2).`
      : `${s.tradesToday} of ${limits.MAX_TRADES_PER_DAY} trades used today.`,
    `Already ${s.tradesToday} trades today, the most allowed (MAX_TRADES_PER_DAY).`,
  );
  step(
    "Risk engine: position size",
    !buying || s.positionPct <= limits.MAX_POSITION_PCT,
    buying ? `${s.positionPct}% of capital, within MAX_POSITION_PCT (${limits.MAX_POSITION_PCT}%).` : "Selling makes the position smaller.",
    `${s.positionPct}% of capital is more than MAX_POSITION_PCT allows (${limits.MAX_POSITION_PCT}%). The risk engine refuses it; it never lets a strategy break a limit.`,
  );
  step(
    "Execution",
    true,
    "Sends the approved order once, with its own client order ID so a retry can't double it, and checks it filled.",
    "",
  );
  step("Broker", true, "Alpaca's paper account fills it with pretend money. Live trading needs four locks at once.", "");
  return stages;
}
