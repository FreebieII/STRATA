// Orders: follow one sell order through ten made-up days, one day at a time.

import { useState } from "react";

import { useWidth } from "../../charts/useWidth";
import { linear } from "../../charts/scale";
import { Segmented } from "../../components/Filters";
import { Term } from "../Prose";
import { SELL_SCENARIOS } from "../synthetic";
import { Lab, money, signedPct, Slider } from "./Lab";
import { saleOf, simulateSell, type Bar, type SellOrder } from "./sim";

type Kind = SellOrder["kind"];

const KINDS: { value: Kind; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
  { value: "stop-limit", label: "Stop-limit" },
];

const WHAT: Record<Kind, string> = {
  market: "Sell now, at whatever the price is.",
  limit: "Sell only at your price or better: a take-profit.",
  stop: "When the price falls to your stop, sell at market: a stop-loss.",
  "stop-limit": "When the price falls to your stop, place a limit order: it won't sell below the limit.",
};

const BOUGHT = 100;

export function OrderLab({ stopPct, positionUsd }: { stopPct: number; positionUsd: number }) {
  const defaultStop = Math.round((BOUGHT * (1 - stopPct / 100)) * 2) / 2;
  const [kind, setKind] = useState<Kind>("stop");
  const [scenarioId, setScenarioId] = useState("gap");
  const [stop, setStop] = useState(defaultStop);
  const [limitGap, setLimitGap] = useState(1);
  const [target, setTarget] = useState(Math.round(BOUGHT * (1 + (2 * stopPct) / 100)));
  const [day, setDay] = useState(0);

  const scenario = SELL_SCENARIOS.find((s) => s.id === scenarioId) ?? SELL_SCENARIOS[0]!;
  const order: SellOrder =
    kind === "market"
      ? { kind }
      : kind === "limit"
        ? { kind, limit: target }
        : kind === "stop"
          ? { kind, stop }
          : { kind, stop, limit: stop - limitGap };
  const days = simulateSell(order, scenario.bars);
  const sale = saleOf(days);
  const last = scenario.bars.length - 1;
  const shown = days.slice(0, day + 1);
  const soldBy = sale && sale.day <= day ? sale : null;
  const today = days[day]!;
  const levels: { value: number; label: string }[] = [{ value: BOUGHT, label: `bought ${money(BOUGHT)}` }];
  if (kind === "limit") levels.push({ value: target, label: `limit ${money(target)}` });
  if (kind === "stop" || kind === "stop-limit") levels.push({ value: stop, label: `stop ${money(stop)}` });
  if (kind === "stop-limit") levels.push({ value: stop - limitGap, label: `limit ${money(stop - limitGap)}` });

  const change = (price: number) => ((price - BOUGHT) / BOUGHT) * 100;
  const reset = (next: () => void) => {
    next();
    setDay(0);
  };

  return (
    <Lab
      title="Follow one sell order, day by day"
      kind="made-up"
      intro={
        <>
          You own shares bought at {money(BOUGHT)}. Choose how to sell and what happens next, then step
          through the days. Each day shows its range, from the lowest price to the highest.
        </>
      }
      note={
        <>
          Simplified: any price inside a day's range can be reached, but the jump from one day's close
          to the next day's open (a <Term id="gap">gap</Term>) can't be traded in. Real orders fill trade
          by trade, and in a fast market a stop can sell well below its price.
        </>
      }
    >
      <div className="lab-controls">
        <Segmented<Kind> label="Order" options={KINDS} value={kind} onChange={(v) => reset(() => setKind(v ?? "stop"))} />
        <Segmented<string>
          label="What happens"
          options={SELL_SCENARIOS.map((s) => ({ value: s.id, label: s.label }))}
          value={scenarioId}
          onChange={(v) => reset(() => setScenarioId(v ?? "gap"))}
        />
      </div>
      <p className="lab__explain">
        <strong>{KINDS.find((k) => k.value === kind)!.label}:</strong> {WHAT[kind]} <strong>{scenario.label}:</strong>{" "}
        {scenario.story}
      </p>
      <div className="lab-controls">
        {kind === "limit" ? (
          <Slider label="Sell at or above" value={target} min={101} max={115} step={0.5} onChange={(v) => reset(() => setTarget(v))} format={(v) => money(v)} />
        ) : null}
        {kind === "stop" || kind === "stop-limit" ? (
          <Slider label="Stop at" value={stop} min={85} max={99.5} step={0.5} onChange={(v) => reset(() => setStop(v))} format={(v) => money(v)} />
        ) : null}
        {kind === "stop-limit" ? (
          <Slider
            label="Limit below the stop"
            value={limitGap}
            min={0}
            max={5}
            step={0.5}
            onChange={(v) => reset(() => setLimitGap(v))}
            format={(v) => `${money(v)} (limit ${money(stop - v)})`}
          />
        ) : null}
      </div>

      <DayBars bars={scenario.bars} upTo={day} levels={levels} sale={soldBy} />

      <div className="lab-stepper">
        <button type="button" className="button button--small" onClick={() => setDay((d) => Math.max(0, d - 1))} disabled={day === 0}>
          Previous day
        </button>
        <span className="lab-stepper__where mono">
          Day {day + 1} of {last + 1}
        </span>
        <button type="button" className="button button--small button--primary" onClick={() => setDay((d) => Math.min(last, d + 1))} disabled={day === last}>
          Next day
        </button>
        <button type="button" className="button button--small button--ghost" onClick={() => setDay(last)} disabled={day === last}>
          Show all
        </button>
      </div>

      <p className={`lab-today lab-today--${today.state}`} aria-live="polite">
        <strong>Day {day + 1}.</strong> {today.note}
      </p>
      <ol className="lab-log" aria-label="What happened each day">
        {shown.slice(0, -1).map((d) => (
          <li key={d.day} className={d.state === "sold" ? "is-sold" : undefined}>
            <span className="mono">Day {d.day + 1}</span> {d.note}
          </li>
        ))}
      </ol>
      <p className="lab__result" aria-live="polite">
        {soldBy
          ? `Sold on day ${soldBy.day + 1} at ${money(soldBy.price)}: ${signedPct(change(soldBy.price))}, ${money(((soldBy.price - BOUGHT) / BOUGHT) * positionUsd)} on a ${money(positionUsd, 0)} position.`
          : day === last
            ? `Not sold after ${last + 1} days. Still holding at ${money(scenario.bars[last]!.close)}: ${signedPct(change(scenario.bars[last]!.close))}, ${money(((scenario.bars[last]!.close - BOUGHT) / BOUGHT) * positionUsd)} on a ${money(positionUsd, 0)} position.`
            : "Not sold yet. Step on to see what happens."}
      </p>
    </Lab>
  );
}

/** Label positions, top to bottom, at least a line apart so none overlap. */
export function spaced(labels: { label: string; at: number }[], gap = 13): { label: string; at: number }[] {
  const sorted = [...labels].sort((a, b) => a.at - b.at);
  sorted.forEach((label, i) => {
    const above = sorted[i - 1];
    if (above && label.at < above.at + gap) label.at = above.at + gap;
  });
  return sorted;
}

/** Daily ranges (high to low) with the open and close marked, and the order's levels. */
function DayBars({
  bars,
  upTo,
  levels,
  sale,
}: {
  bars: Bar[];
  upTo: number;
  levels: { value: number; label: string }[];
  sale: { day: number; price: number } | null;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  const height = 210;
  const left = 8;
  const right = 104;
  const values = [...bars.flatMap((b) => [b.high, b.low]), ...levels.map((l) => l.value)];
  const lo = Math.min(...values) - 1;
  const hi = Math.max(...values) + 1;
  const y = linear(lo, hi, height - 22, 10);
  const slot = (width - left - right) / bars.length;
  const x = (i: number) => left + slot * (i + 0.5);
  const body = Math.min(14, slot * 0.5);
  const described = bars
    .slice(0, upTo + 1)
    .map((b, i) => `day ${i + 1}: open ${b.open}, high ${b.high}, low ${b.low}, close ${b.close}`)
    .join("; ");
  return (
    <div ref={wrapper} className="lab-chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Prices so far. ${described}.`}>
        {levels.map((level) => (
          <line
            key={level.label}
            className={level.label.startsWith("bought") ? "chart-baseline" : "plot__level"}
            x1={left}
            x2={width - right + 6}
            y1={Math.round(y(level.value)) + 0.5}
            y2={Math.round(y(level.value)) + 0.5}
          />
        ))}
        {bars.map((b, i) => {
          if (i > upTo) {
            return <rect key={i} className="lab-chart__future" x={x(i) - body / 2} y={10} width={body} height={height - 32} rx={3} />;
          }
          const up = b.close >= b.open;
          return (
            <g key={i} className={i === upTo ? "lab-chart__day is-today" : "lab-chart__day"}>
              <line className="lab-chart__range" x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} />
              <rect
                className={up ? "lab-chart__body lab-chart__body--up" : "lab-chart__body lab-chart__body--down"}
                x={x(i) - body / 2}
                y={y(Math.max(b.open, b.close))}
                width={body}
                height={Math.max(1.5, Math.abs(y(b.open) - y(b.close)))}
                rx={1.5}
              />
            </g>
          );
        })}
        {sale ? <circle className="chart-marker" cx={x(sale.day)} cy={y(sale.price)} r={5} strokeWidth={2} /> : null}
        {spaced(levels.map((level) => ({ label: level.label, at: y(level.value) + 4 }))).map((label) => (
          <text key={label.label} className="plot__level-label" x={width - right + 12} y={label.at}>
            {label.label}
          </text>
        ))}
        {bars.map((_, i) => (
          <text key={i} className="chart-tick" x={x(i)} y={height - 6} textAnchor="middle">
            {i + 1}
          </text>
        ))}
      </svg>
    </div>
  );
}
