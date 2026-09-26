// Columns over time (one per day), optionally stacked by series.
//
// Thin columns (at most 24 px) grow from one baseline, square at the bottom
// and rounded at the top; stacked parts are separated by a 2 px gap. Point
// at a column, or focus the chart and use the arrow keys, to see every
// series' value for that day. The same numbers are in the table view.

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";

import { ChartTooltip, TipRow } from "./ChartFrame";
import { columnPath, compact, labelEvery, linear, niceTicks } from "./scale";
import { useWidth } from "./useWidth";

export type ColumnSeries = { key: string; label: string; color: string };

export type Column = {
  key: string;
  // Under the axis ("Sep 20").
  label: string;
  // In the tooltip ("Saturday, 20 September").
  longLabel: string;
  values: Record<string, number>;
};

const TOP = 12;
const BOTTOM = 24;
const GAP = 2;
const MAX_BAR = 24;

export function ColumnChart({
  series,
  columns,
  label,
  noun,
  height = 210,
  highlight = null,
}: {
  // Bottom to top.
  series: ColumnSeries[];
  columns: Column[];
  // What the chart shows, for screen readers.
  label: string;
  // What is being counted ("events"), for the totals.
  noun: string;
  height?: number;
  // A series to emphasise; the others fade.
  highlight?: string | null;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const readoutId = useId();

  const totals = columns.map((c) => series.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals), 4, true);
  const top = ticks[ticks.length - 1] ?? 1;
  const tickWidth = Math.max(...ticks.map((t) => compact.format(t).length)) * 7 + 12;
  const left = tickWidth;
  const plotWidth = Math.max(40, width - left - 4);
  const base = height - BOTTOM;
  const y = linear(0, top, base, TOP);
  const slot = plotWidth / Math.max(1, columns.length);
  const bar = Math.max(2, Math.min(MAX_BAR, slot * 0.64));
  const every = labelEvery(columns.length, Math.floor(plotWidth / 56));
  const empty = totals.every((t) => t === 0);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - left) / slot);
    setActive(index >= 0 && index < columns.length ? index : null);
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const last = columns.length - 1;
    const current = active ?? last;
    const next: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(last, current + 1),
      Home: 0,
      End: last,
    };
    if (event.key === "Escape") setActive(null);
    const to = next[event.key];
    if (to === undefined) return;
    event.preventDefault();
    setActive(to);
  };

  const shown = active !== null ? columns[active] : undefined;
  const shownTotal = active !== null ? (totals[active] ?? 0) : 0;
  const readout = shown
    ? `${shown.longLabel}: ${series.map((s) => `${shown.values[s.key] ?? 0} ${s.label.toLowerCase()}`).join(", ")}`
    : "";

  return (
    <div className="columns" ref={wrapper}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="columns__plot"
        role="img"
        aria-label={`${label}. ${columns.length} days, ${totals.reduce((a, b) => a + b, 0)} ${noun} in all. Use the arrow keys to read each day.`}
        aria-describedby={readoutId}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 0 ? "chart-baseline" : "chart-grid"}
              x1={left}
              x2={width - 4}
              y1={Math.round(y(tick)) + 0.5}
              y2={Math.round(y(tick)) + 0.5}
            />
            <text className="chart-tick" x={left - 8} y={y(tick) + 4} textAnchor="end">
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {active !== null ? (
          <rect className="chart-hover" x={left + active * slot} y={TOP - 6} width={slot} height={base - TOP + 6} />
        ) : null}
        {columns.map((column, i) => {
          const x = left + i * slot + (slot - bar) / 2;
          let level = base;
          const parts = series
            .map((s) => ({ s, value: column.values[s.key] ?? 0 }))
            .filter((part) => part.value > 0);
          return (
            <g key={column.key}>
              {parts.map((part, k) => {
                // The gap between stacked parts is taken from the lower part.
                const full = Math.max(1, base - y(part.value));
                const isTop = k === parts.length - 1;
                const partHeight = Math.max(1, isTop ? full : full - GAP);
                const partTop = level - partHeight;
                level -= full;
                const faded = highlight !== null && highlight !== part.s.key;
                return (
                  <path
                    key={part.s.key}
                    d={columnPath(x, partTop, bar, partHeight, isTop ? 4 : 0)}
                    style={{ fill: part.s.color, opacity: faded ? 0.22 : 1 }}
                  />
                );
              })}
            </g>
          );
        })}
        {columns.map((column, i) =>
          // Counted back from the newest day, so the last label never collides.
          (columns.length - 1 - i) % every === 0 ? (
            <text key={column.key} className="chart-tick" x={left + i * slot + slot / 2} y={height - 6} textAnchor="middle">
              {column.label}
            </text>
          ) : null,
        )}
        {empty ? (
          <text className="chart-empty" x={left + plotWidth / 2} y={(TOP + base) / 2} textAnchor="middle">
            Nothing recorded in this period
          </text>
        ) : null}
      </svg>
      {shown ? (
        <ChartTooltip x={left + (active ?? 0) * slot + slot / 2} y={4} width={width}>
          <p className="chart-tip__title">{shown.longLabel}</p>
          {[...series].reverse().map((s) => (
            <TipRow key={s.key} color={s.color} value={String(shown.values[s.key] ?? 0)} label={s.label} />
          ))}
          <TipRow value={String(shownTotal)} label={`${noun} in all`} />
        </ChartTooltip>
      ) : null}
      <p className="sr-only" id={readoutId} aria-live="polite">
        {readout}
      </p>
    </div>
  );
}

/** The table twin of a ColumnChart. */
export function ColumnTable({
  series,
  columns,
  caption,
}: {
  series: ColumnSeries[];
  columns: Column[];
  caption: string;
}) {
  return (
    <table className="table table--compact">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          {series.map((s) => (
            <th scope="col" className="num" key={s.key}>
              {s.label}
            </th>
          ))}
          <th scope="col" className="num">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {[...columns].reverse().map((column) => (
          <tr key={column.key}>
            <td>{column.longLabel}</td>
            {series.map((s) => (
              <td className="num" key={s.key}>
                {column.values[s.key] ?? 0}
              </td>
            ))}
            <td className="num strong">{series.reduce((sum, s) => sum + (column.values[s.key] ?? 0), 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
