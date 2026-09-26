// What trading costs, worked out from the cost settings in config.yaml.
// Percentages apply to every buy and every sell; the flat fee to every sell.

import type { CostSummary } from "../api/types";

export type RoundTrip = {
  // Broker and regulatory fees for one buy and one sell, in dollars.
  fees: number;
  // The expected price loss from slippage on both fills, in dollars.
  slippage: number;
  total: number;
  // The total as a percentage of the position: how far the price must rise
  // before the trade makes any money.
  breakevenPct: number;
};

export function roundTrip(costs: CostSummary, value: number): RoundTrip {
  const fees = (2 * value * costs.fee_pct) / 100 + costs.fee_per_sell_usd;
  const slippage = (2 * value * costs.slippage_pct) / 100;
  const total = fees + slippage;
  return { fees, slippage, total, breakevenPct: value > 0 ? (total / value) * 100 : 0 };
}
