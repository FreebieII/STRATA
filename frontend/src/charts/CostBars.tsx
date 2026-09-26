// What one round trip (a buy and a sell) costs, split into fees and
// slippage: one horizontal bar per asset class, on one dollar scale.

import { formatUsd } from "../lib/format";
import type { RoundTrip } from "../lib/costs";
import type { LegendItem } from "./ChartFrame";

export const COST_LEGEND: LegendItem[] = [
  { key: "fees", label: "Fees", color: "var(--series-1)" },
  { key: "slippage", label: "Slippage", color: "var(--series-2)" },
];

function money(value: number): string {
  return value < 1 ? `$${value.toFixed(2)}` : formatUsd(Math.round(value * 100) / 100);
}

/** 0.13%, 0.80%, 1.5%: small percentages keep two decimals. */
export function smallPct(value: number): string {
  return `${value < 1 ? value.toFixed(2) : value.toFixed(1)}%`;
}

export function CostBars({ rows }: { rows: { label: string; cost: RoundTrip }[] }) {
  const top = Math.max(0.01, ...rows.map((row) => row.cost.total));
  return (
    <ol className="costs" aria-label="Cost of one round trip">
      {rows.map(({ label, cost }) => (
        <li className="costs__row" key={label}>
          <span className="costs__name">{label}</span>
          <span className="costs__track">
            {cost.fees > 0 ? (
              <span
                className={`costs__part${cost.slippage > 0 ? "" : " costs__part--end"}`}
                style={{ width: `${(cost.fees / top) * 78}%`, background: "var(--series-1)" }}
                title={`Fees ${money(cost.fees)}`}
              />
            ) : null}
            {cost.slippage > 0 ? (
              <span
                className="costs__part costs__part--end"
                style={{ width: `${(cost.slippage / top) * 78}%`, background: "var(--series-2)" }}
                title={`Slippage ${money(cost.slippage)}`}
              />
            ) : null}
            <span className="costs__value">
              <span className="strong">{money(cost.total)}</span>{" "}
              <span className="muted">({smallPct(cost.breakevenPct)})</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CostTable({ rows, value }: { rows: { label: string; cost: RoundTrip }[]; value: number }) {
  return (
    <table className="table table--compact">
      <caption className="sr-only">Cost of one round trip on a {formatUsd(value)} position</caption>
      <thead>
        <tr>
          <th scope="col">Asset class</th>
          <th scope="col" className="num">Fees</th>
          <th scope="col" className="num">Slippage</th>
          <th scope="col" className="num">Total</th>
          <th scope="col" className="num">Price rise needed to break even</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ label, cost }) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{money(cost.fees)}</td>
            <td className="num">{money(cost.slippage)}</td>
            <td className="num strong">{money(cost.total)}</td>
            <td className="num">{smallPct(cost.breakevenPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
