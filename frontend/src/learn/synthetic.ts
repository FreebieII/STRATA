// Made-up prices for the Learn section's illustrations. They are generated
// from a fixed seed, so the pictures never change, and they are labelled as
// illustrations wherever they appear: they are not market data.

/** A small, repeatable random number generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Regime = { days: number; drift: number; volatility: number };

/**
 * Daily prices that follow a sequence of moods ("regimes"): each day's move is
 * the regime's drift plus a random wobble, both as fractions of the price.
 */
export function pricePath(start: number, regimes: Regime[], seed: number): number[] {
  const random = seeded(seed);
  // Roughly normal wobble: the average of four uniform draws, centred.
  const wobble = () => (random() + random() + random() + random() - 2) * 1.7;
  const prices = [start];
  for (const regime of regimes) {
    for (let d = 0; d < regime.days; d++) {
      const last = prices[prices.length - 1]!;
      prices.push(Math.max(1, last * (1 + regime.drift + regime.volatility * wobble())));
    }
  }
  return prices;
}

// The paths the illustrations use. A trend that turns, for the crossover:
// drifting down, a long rise, a top, a long fall, then sideways from day 210...
export const TRENDING_SIDEWAYS_FROM = 210;
export const TRENDING = pricePath(
  100,
  [
    { days: 60, drift: -0.0012, volatility: 0.009 },
    { days: 75, drift: 0.0038, volatility: 0.01 },
    { days: 20, drift: 0, volatility: 0.011 },
    { days: 55, drift: -0.0038, volatility: 0.011 },
    { days: 70, drift: 0, volatility: 0.012 },
  ],
  131,
);

// ...a market going sideways with swings, for RSI mean reversion...
export const RANGING = pricePath(
  100,
  [
    { days: 30, drift: -0.004, volatility: 0.01 },
    { days: 25, drift: 0.005, volatility: 0.01 },
    { days: 30, drift: -0.0045, volatility: 0.011 },
    { days: 35, drift: 0.0045, volatility: 0.01 },
    { days: 30, drift: -0.004, volatility: 0.012 },
    { days: 40, drift: 0.004, volatility: 0.01 },
  ],
  11,
);

// ...and an account's value with a bad stretch, for drawdown.
export const EQUITY = pricePath(
  300,
  [
    { days: 60, drift: 0.0015, volatility: 0.006 },
    { days: 45, drift: -0.003, volatility: 0.008 },
    { days: 80, drift: 0.0022, volatility: 0.006 },
    { days: 30, drift: -0.002, volatility: 0.007 },
    { days: 45, drift: 0.0015, volatility: 0.006 },
  ],
  3,
);
