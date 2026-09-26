// The API's own health readings over time: a strip of time slots per check
// (did every reading pass?) and small line charts of response time, one per
// check, each on its own scale. Pointing at one chart shows the same moment
// in all of them.

import { useId, type KeyboardEvent, type PointerEvent } from "react";

import type { HealthPoint, HealthSeries } from "../api/types";
import { IconCritical, IconGood, IconSerious, IconUnknown } from "../components/Icons";
import { formatMs, formatTime, humanise } from "../lib/format";
import { ChartTooltip, TipRow, type LegendItem } from "./ChartFrame";
import { linear, niceTicks } from "./scale";
import { useWidth } from "./useWidth";

export type SlotState = "good" | "partial" | "failed" | "none";

export function slotState(point: HealthPoint): SlotState {
  if (point.samples === 0) return "none";
  if (point.failed === 0) return "good";
  return point.failed === point.samples ? "failed" : "partial";
}

const SLOT_COLOR: Record<SlotState, string> = {
  good: "var(--good)",
  partial: "var(--serious)",
  failed: "var(--critical)",
  none: "var(--nodata)",
};

const SLOT_LABEL: Record<SlotState, string> = {
  good: "every reading passed",
  partial: "some readings failed",
  failed: "every reading failed",
  none: "no readings",
};

export const UPTIME_LEGEND: LegendItem[] = [
  { key: "good", label: "All passed", color: SLOT_COLOR.good, icon: IconGood },
  { key: "partial", label: "Some failed", color: SLOT_COLOR.partial, icon: IconSerious },
  { key: "failed", label: "All failed", color: SLOT_COLOR.failed, icon: IconCritical },
  { key: "none", label: "No reading", color: "var(--muted)", icon: IconUnknown },
];

function slotRange(point: HealthPoint, bucketS: number): string {
  const end = new Date(point.start).getTime() + bucketS * 1000;
  return `${formatTime(point.start).slice(0, 5)}–${formatTime(end).slice(0, 5)}`;
}

/** One row of time slots per check, coloured by whether the readings passed. */
export function UptimeStrips({
  series,
  bucketS,
  active,
  onActive,
}: {
  series: HealthSeries[];
  bucketS: number;
  // The slot being pointed at, shared with the latency charts.
  active: number | null;
  onActive: (index: number | null) => void;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>();
  const count = series[0]?.points.length ?? 0;
  const labelWidth = Math.min(150, Math.max(96, width * 0.22));
  const plot = Math.max(40, width - labelWidth - 64);
  const slot = plot / Math.max(1, count);
  const readoutId = useId();

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left) / slot);
    onActive(index >= 0 && index < count ? index : null);
  };
  const onKey = keyNav(count, active, onActive);

  const reference = active !== null ? series[0]?.points[active] : undefined;

  return (
    <div className="uptime" ref={wrapper}>
      {series.map((item) => (
        <div className="uptime__row" key={item.name}>
          <span className="uptime__name" style={{ width: labelWidth }}>
            {humanise(item.name)}
          </span>
          <svg
            className="uptime__plot"
            width={plot}
            height={22}
            viewBox={`0 0 ${plot} 22`}
            role="img"
            aria-label={`${humanise(item.name)}: ${item.availability_pct ?? "no"}% of readings passed`}
            aria-describedby={readoutId}
            tabIndex={0}
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => onActive(null)}
            onKeyDown={onKey}
            onBlur={() => onActive(null)}
          >
            {item.points.map((point, i) => (
              <rect
                key={point.start}
                x={i * slot + 1}
                y={active === i ? 0 : 3}
                width={Math.max(1, slot - 2)}
                height={active === i ? 22 : 16}
                rx={Math.min(2, slot / 4)}
                style={{ fill: SLOT_COLOR[slotState(point)] }}
              />
            ))}
          </svg>
          <span className="uptime__value">
            {item.availability_pct === null ? "—" : `${formatPct(item.availability_pct)}`}
          </span>
        </div>
      ))}
      <p className="uptime__readout" id={readoutId} aria-live="polite">
        {reference
          ? `${slotRange(reference, bucketS)} · ` +
            series
              .map((item) => {
                const point = item.points[active ?? 0];
                return point ? `${humanise(item.name)}: ${SLOT_LABEL[slotState(point)]}` : "";
              })
              .join(" · ")
          : "Point at a slot to see what happened then."}
      </p>
    </div>
  );
}

function formatPct(value: number): string {
  return `${value >= 99.995 ? "100" : value.toFixed(value >= 99 ? 2 : 1)}%`;
}

function keyNav(count: number, active: number | null, onActive: (index: number | null) => void) {
  return (event: KeyboardEvent<SVGSVGElement>) => {
    if (!count) return;
    const last = count - 1;
    const current = active ?? last;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(last, current + 1),
      Home: 0,
      End: last,
    };
    if (event.key === "Escape") onActive(null);
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    onActive(to);
  };
}

const PANEL_HEIGHT = 124;
const TOP = 10;
const BOTTOM = 22;
const LEFT = 44;

/** Response time over the window: one small chart per check, each on its own scale. */
export function LatencyPanels({
  series,
  bucketS,
  active,
  onActive,
}: {
  series: HealthSeries[];
  bucketS: number;
  active: number | null;
  onActive: (index: number | null) => void;
}) {
  const timed = series.filter((item) => item.points.some((p) => p.latency_avg_ms !== null));
  if (!timed.length) return <p className="empty-line">No response times recorded yet.</p>;
  return (
    <div className="panels">
      {timed.map((item) => (
        <LatencyPanel key={item.name} series={item} bucketS={bucketS} active={active} onActive={onActive} />
      ))}
    </div>
  );
}

function LatencyPanel({
  series,
  bucketS,
  active,
  onActive,
}: {
  series: HealthSeries;
  bucketS: number;
  active: number | null;
  onActive: (index: number | null) => void;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>(320);
  const points = series.points;
  const values = points.map((p) => p.latency_avg_ms).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.max(...values, 0.1), 3);
  const top = ticks[ticks.length - 1] ?? 1;
  const base = PANEL_HEIGHT - BOTTOM;
  const plot = Math.max(40, width - LEFT - 6);
  const step = plot / Math.max(1, points.length - 1);
  const x = (i: number) => LEFT + i * step;
  const y = linear(0, top, base, TOP);

  // Unbroken runs of slots with a value become line segments.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  points.forEach((p, i) => {
    if (p.latency_avg_ms === null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push({ i, v: p.latency_avg_ms });
  });
  if (run.length) runs.push(run);
  const path = (r: { i: number; v: number }[]) =>
    r.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.round((event.clientX - box.left - LEFT) / step);
    onActive(index >= 0 && index < points.length ? index : null);
  };

  const shown = active !== null ? points[active] : undefined;
  const latest = [...points].reverse().find((p) => p.latency_avg_ms !== null);
  const name = humanise(series.name);

  return (
    <div className="panel" ref={wrapper}>
      <p className="panel__title">
        <span className="strong">{name}</span>
        <span className="muted">
          {" "}
          · milliseconds, average per slot · latest{" "}
          {latest?.latency_avg_ms != null ? formatMs(latest.latency_avg_ms) : "—"}
        </span>
      </p>
      <svg
        width={width}
        height={PANEL_HEIGHT}
        viewBox={`0 0 ${width} ${PANEL_HEIGHT}`}
        role="img"
        aria-label={`${name} response time, average per slot`}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => onActive(null)}
        onKeyDown={keyNav(points.length, active, onActive)}
        onBlur={() => onActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? "chart-baseline" : "chart-grid"}
              x1={LEFT}
              x2={width - 6}
              y1={Math.round(y(tick)) + 0.5}
              y2={Math.round(y(tick)) + 0.5}
            />
            <text className="chart-tick" x={LEFT - 6} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {runs.map((r) =>
          r.length > 1 ? (
            <path key={r[0]!.i} className="chart-line" d={path(r)} />
          ) : (
            <circle key={r[0]!.i} className="chart-dot" cx={x(r[0]!.i)} cy={y(r[0]!.v)} r={2.5} />
          ),
        )}
        {points.map((p, i) =>
          p.failed > 0 ? (
            <rect key={p.start} className="spark__fail" x={x(i) - 1} y={base - 6} width={2} height={8} rx={1} />
          ) : null,
        )}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) =>
          points[i] ? (
            <text
              key={`t${i}`}
              className="chart-tick"
              x={x(i)}
              y={PANEL_HEIGHT - 6}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            >
              {formatTime(points[i].start).slice(0, 5)}
            </text>
          ) : null,
        )}
        {shown ? <line className="chart-cursor" x1={x(active!) + 0.5} x2={x(active!) + 0.5} y1={TOP} y2={base} /> : null}
        {shown && shown.latency_avg_ms !== null ? (
          <circle className="chart-marker" cx={x(active!)} cy={y(shown.latency_avg_ms)} r={4} strokeWidth={2} />
        ) : null}
      </svg>
      {shown ? (
        <ChartTooltip x={x(active!)} y={PANEL_HEIGHT - 8} width={width}>
          <p className="chart-tip__title">{slotRange(shown, bucketS)}</p>
          {shown.latency_avg_ms !== null ? (
            <>
              <TipRow color="var(--series-1)" value={formatMs(shown.latency_avg_ms)} label="average" />
              <TipRow value={shown.latency_max_ms !== null ? formatMs(shown.latency_max_ms) : "—"} label="slowest" />
            </>
          ) : null}
          <TipRow value={String(shown.samples)} label="readings" />
          {shown.failed ? <TipRow value={String(shown.failed)} label="failed" /> : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}

/** The table twin of the health charts. */
export function HealthTable({ series, bucketS }: { series: HealthSeries[]; bucketS: number }) {
  const count = series[0]?.points.length ?? 0;
  const rows = Array.from({ length: count }, (_, i) => count - 1 - i).filter((i) =>
    series.some((s) => (s.points[i]?.samples ?? 0) > 0),
  );
  return (
    <table className="table table--compact">
      <caption className="sr-only">Health readings per time slot, newest first</caption>
      <thead>
        <tr>
          <th scope="col">Time</th>
          {series.map((s) => (
            <th scope="col" key={s.name} className="num">
              {humanise(s.name)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={series[0]!.points[i]!.start}>
            <td className="mono">{slotRange(series[0]!.points[i]!, bucketS)}</td>
            {series.map((s) => {
              const p = s.points[i];
              if (!p || !p.samples) return <td key={s.name} className="num muted">no readings</td>;
              const time = p.latency_avg_ms !== null ? `${formatMs(p.latency_avg_ms)} avg` : "";
              const failures = p.failed ? `${p.failed} of ${p.samples} failed` : `${p.samples} passed`;
              return (
                <td key={s.name} className="num">
                  {[time, failures].filter(Boolean).join(" · ")}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
