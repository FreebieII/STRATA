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

// ...and ten days of made-up prices after buying at $100, for following one
// sell order day by day. Each tells a different story.
type DayBar = { open: number; high: number; low: number; close: number };
const bars = (rows: [number, number, number, number][]): DayBar[] =>
  rows.map(([open, high, low, close]) => ({ open, high, low, close }));

const BEFORE_THE_NEWS: [number, number, number, number][] = [
  [100.0, 101.1, 99.6, 100.7],
  [100.7, 101.4, 100.1, 100.4],
  [100.4, 100.9, 99.2, 99.5],
  [99.5, 99.8, 98.1, 98.4],
];

export const SELL_SCENARIOS: { id: string; label: string; story: string; bars: DayBar[] }[] = [
  {
    id: "fall",
    label: "A slow fall",
    story: "The price drifts down a little every day.",
    bars: bars([
      [100.0, 100.9, 99.4, 99.8],
      [99.8, 100.3, 98.6, 98.9],
      [98.9, 99.2, 97.5, 97.8],
      [97.8, 98.4, 96.6, 96.9],
      [96.9, 97.1, 95.4, 95.7],
      [95.7, 96.0, 94.3, 94.6],
      [94.6, 95.2, 93.4, 93.7],
      [93.7, 94.1, 92.6, 92.9],
      [92.9, 93.8, 92.4, 93.5],
      [93.5, 94.2, 93.0, 93.9],
    ]),
  },
  {
    id: "gap",
    label: "Bad news overnight",
    story: "After four quiet days, bad news comes out while the market is closed. The price opens far lower and keeps falling.",
    bars: bars([
      ...BEFORE_THE_NEWS,
      [91.2, 92.4, 90.1, 91.8],
      [91.8, 92.2, 88.9, 89.4],
      [89.4, 89.9, 86.8, 87.2],
      [87.2, 88.1, 86.1, 87.6],
      [87.6, 88.4, 86.9, 88.1],
      [88.1, 89.0, 87.4, 88.6],
    ]),
  },
  {
    id: "bounce",
    label: "Bad news, then a bounce",
    story: "The same overnight fall, but this time the price recovers over the next days.",
    bars: bars([
      ...BEFORE_THE_NEWS,
      [91.2, 92.4, 90.1, 91.8],
      [91.8, 93.3, 91.4, 93.0],
      [93.0, 94.6, 92.7, 94.3],
      [94.3, 95.4, 93.9, 95.1],
      [95.1, 96.2, 94.8, 95.9],
      [95.9, 96.6, 95.2, 96.3],
    ]),
  },
  {
    id: "rally",
    label: "A rally",
    story: "The price climbs steadily.",
    bars: bars([
      [100.0, 101.2, 99.7, 100.9],
      [100.9, 102.1, 100.4, 101.8],
      [101.8, 103.0, 101.3, 102.6],
      [102.6, 103.9, 102.1, 103.5],
      [103.5, 104.2, 102.8, 103.2],
      [103.2, 105.1, 102.9, 104.8],
      [104.8, 106.4, 104.2, 106.0],
      [106.0, 107.9, 105.6, 107.5],
      [107.5, 109.2, 107.0, 108.8],
      [108.8, 110.6, 108.3, 110.2],
    ]),
  },
];

// ...and the offers to sell in a made-up order book, cheapest first. The top
// three match the bid-and-ask picture in the Markets chapter.
export const ORDER_BOOK_ASKS: { price: number; size: number }[] = [
  { price: 100.01, size: 300 },
  { price: 100.02, size: 150 },
  { price: 100.03, size: 200 },
  { price: 100.05, size: 400 },
  { price: 100.08, size: 500 },
  { price: 100.12, size: 800 },
];
