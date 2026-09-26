// Strategies: choose the two averages and the market, and trade the crossover.

import { useState } from "react";

import { Legend } from "../../charts/ChartFrame";
import { Segmented } from "../../components/Filters";
import { Plot } from "../illustrations/Plot";
import { Term } from "../Prose";
import { RANGING, TRENDING } from "../synthetic";
import { Lab, money, Readout, signedPct, Slider } from "./Lab";
import { crossoverBacktest } from "./sim";

type Market = "trend" | "sideways";
type Cost = "none" | "stock" | "crypto";

export function CrossoverLab({
  fast: configuredFast,
  slow: configuredSlow,
  costPct,
}: {
  fast: number;
  slow: number;
  // Round-trip cost estimates from config.yaml, as percentages.
  costPct: { stock: number; crypto: number };
}) {
  const clampFast = (n: number) => Math.min(60, Math.max(2, n));
  const [market, setMarket] = useState<Market>("trend");
  const [fast, setFast] = useState(clampFast(configuredFast));
  const [slow, setSlow] = useState(Math.min(120, Math.max(configuredSlow, clampFast(configuredFast) + 5)));
  const [cost, setCost] = useState<Cost>("stock");
  const [active, setActive] = useState<number | null>(null);

  const prices = market === "trend" ? TRENDING : RANGING;
  const pct = cost === "none" ? 0 : costPct[cost];
  const result = crossoverBacktest(prices, fast, slow, pct);
  const finished = result.trades.filter((t) => t.sell !== null);
  const won = finished.filter((t) => t.returnPct > 0).length;
  const lead = result.totalPct - result.buyHoldPct;
  const isConfigured = fast === configuredFast && slow === configuredSlow;

  const onFast = (value: number) => {
    setFast(value);
    if (slow < value + 5) setSlow(Math.min(120, value + 5));
  };

  return (
    <Lab
      title="Crossover lab: choose the averages, then trade them"
      kind="made-up"
      intro="Pick a kind of market and the lengths of the two averages. The strategy buys when the fast one rises above the slow one and sells when it falls back below."
      note="A signal needs a day's close, so the lab trades at the next day's close: trading at the same close would be look-ahead bias. The cost is taken once per round trip. STRATA's backtests (Phase 4) will model costs, slippage and timing in more detail."
    >
      <div className="lab-controls">
        <Segmented<Market>
          label="Market"
          options={[
            { value: "trend", label: "Trends, then sideways" },
            { value: "sideways", label: "Swings around a level" },
          ]}
          value={market}
          onChange={(v) => setMarket(v ?? "trend")}
        />
        <Segmented<Cost>
          label="Costs per round trip"
          options={[
            { value: "none", label: "None" },
            { value: "stock", label: `Stock ${costPct.stock.toFixed(2)}%` },
            { value: "crypto", label: `Crypto ${costPct.crypto.toFixed(2)}%` },
          ]}
          value={cost}
          onChange={(v) => setCost(v ?? "none")}
        />
      </div>
      <div className="lab-controls">
        <Slider label="Fast average" value={fast} min={2} max={60} onChange={onFast} format={(n) => `${n} days`} />
        <Slider label="Slow average" value={slow} min={fast + 5} max={120} onChange={setSlow} format={(n) => `${n} days`} />
        <button
          type="button"
          className="button button--small button--ghost"
          disabled={isConfigured}
          onClick={() => {
            setFast(configuredFast);
            setSlow(configuredSlow);
          }}
        >
          Use STRATA's {configuredFast}/{configuredSlow}
        </button>
      </div>

      <Legend
        items={[
          { key: "price", label: "Price", color: "var(--series-1)", shape: "line" },
          { key: "fast", label: `${fast}-day average`, color: "var(--series-2)", shape: "line" },
          { key: "slow", label: `${slow}-day average`, color: "var(--series-3)", shape: "line" },
          { key: "held", label: "Holding", color: "var(--series-1-track)" },
        ]}
      />
      <Plot
        label={`Made-up prices with ${fast}- and ${slow}-day averages: ${result.trades.length} trades`}
        lines={[
          { key: "price", label: "price", values: prices, color: "var(--series-1)", width: 1.5 },
          { key: "fast", label: `${fast}-day`, values: result.fastLine, color: "var(--series-2)" },
          { key: "slow", label: `${slow}-day`, values: result.slowLine, color: "var(--series-3)" },
        ]}
        markers={result.signals}
        markerOn="fast"
        spans={result.trades.map((t) => ({ from: t.buy, to: t.sell ?? prices.length - 1 }))}
        active={active}
        onActive={setActive}
      />

      <div className="lab-readouts" aria-live="polite">
        <Readout label="The strategy" value={signedPct(result.totalPct)} detail={`after costs, in ${result.trades.length} ${result.trades.length === 1 ? "trade" : "trades"}`} />
        <Readout label="Buying and holding" value={signedPct(result.buyHoldPct)} detail="bought on day 1, never sold" />
        <Readout
          label="Trades that made money"
          value={finished.length ? `${won} of ${finished.length}` : "—"}
          detail={result.trades.length > finished.length ? "plus one still open" : "finished trades"}
        />
        <Readout label="Days in the market" value={`${result.daysHeld} of ${prices.length}`} detail="the rest in cash" />
      </div>
      <p className="lab__explain">
        {result.trades.length === 0
          ? `With a ${slow}-day slow average, the averages never cross on these prices: no trades.`
          : lead >= 0
            ? `Here the strategy beat buying and holding by ${Math.abs(lead).toFixed(1)} points.`
            : `Here buying and holding did better, by ${Math.abs(lead).toFixed(1)} points.`}{" "}
        {market === "sideways"
          ? "In a market that swings around a level, the averages keep crossing: each "
          : "Watch the sideways stretch at the end, where the averages cross back and forth: each "}
        <Term id="whipsaw">whipsaw</Term> is a small loss plus costs. Shorter averages react sooner and
        trade more; longer ones trade less and later.
      </p>

      {result.trades.length ? (
        <div className="table-scroll">
          <table className="table">
            <caption className="table__caption">Every trade</caption>
            <thead>
              <tr>
                <th scope="col">Bought</th>
                <th scope="col">Sold</th>
                <th scope="col">Result after costs</th>
              </tr>
            </thead>
            <tbody>
              {result.trades.map((t) => (
                <tr key={t.buy}>
                  <td>
                    day {t.buy + 1} at <span className="mono">{money(t.buyPrice)}</span>
                  </td>
                  <td>
                    {t.sell === null ? "still held at the end, " : `day ${t.sell + 1} at `}
                    <span className="mono">{money(t.sellPrice)}</span>
                  </td>
                  <td className="mono">{signedPct(t.returnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Lab>
  );
}
