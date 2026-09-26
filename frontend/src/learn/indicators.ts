// The calculations behind the Learn section's illustrations. They follow the
// standard definitions (Wilder's RSI, simple moving averages); STRATA's own
// indicator library in Python (Phase 3) is tested against reference values.

/** Simple moving average: the mean of the last `period` values (null until there are enough). */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  values.forEach((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  });
  return out;
}

/**
 * Relative Strength Index, as J. Welles Wilder defined it (1978): average
 * gains and losses over `period` changes, smoothed with his running average,
 * then RSI = 100 - 100 / (1 + average gain / average loss).
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = value();
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = value();
  }
  return out;
}

export type Cross = { index: number; kind: "up" | "down" };

/** Where `fast` crosses above (up) or below (down) `slow`. */
export function crossovers(fast: (number | null)[], slow: (number | null)[]): Cross[] {
  const crosses: Cross[] = [];
  for (let i = 1; i < fast.length; i++) {
    const f0 = fast[i - 1];
    const s0 = slow[i - 1];
    const f1 = fast[i];
    const s1 = slow[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
    if (f0 <= s0 && f1 > s1) crosses.push({ index: i, kind: "up" });
    if (f0 >= s0 && f1 < s1) crosses.push({ index: i, kind: "down" });
  }
  return crosses;
}


/** The crossings a long-only strategy acts on: a buy while it holds nothing,
 * a sell while it holds. (A fall below while in cash changes nothing.) */
export function longOnly(crosses: Cross[]): Cross[] {
  const acted: Cross[] = [];
  let holding = false;
  for (const cross of crosses) {
    if (cross.kind === "up" && !holding) {
      acted.push(cross);
      holding = true;
    } else if (cross.kind === "down" && holding) {
      acted.push(cross);
      holding = false;
    }
  }
  return acted;
}

/** How far each value is below the highest value so far, in percent (0 or negative). */
export function drawdown(equity: number[]): number[] {
  let peak = -Infinity;
  return equity.map((value) => {
    peak = Math.max(peak, value);
    return peak > 0 ? ((value - peak) / peak) * 100 : 0;
  });
}

/** The gain needed to get back to where you were after losing `lossPct` percent. */
export function recoveryNeeded(lossPct: number): number {
  if (lossPct >= 100) return Infinity;
  return (lossPct / (100 - lossPct)) * 100;
}

/** RSI signals: buy when it falls below `buyBelow`, sell when it rises above `sellAbove`. */
export function rsiSignals(values: (number | null)[], buyBelow: number, sellAbove: number): Cross[] {
  const signals: Cross[] = [];
  let holding = false;
  values.forEach((value, index) => {
    if (value == null) return;
    if (!holding && value < buyBelow) {
      signals.push({ index, kind: "up" });
      holding = true;
    } else if (holding && value > sellAbove) {
      signals.push({ index, kind: "down" });
      holding = false;
    }
  });
  return signals;
}
