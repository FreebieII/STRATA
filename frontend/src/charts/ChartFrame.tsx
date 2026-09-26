// The frame every chart sits in: a title, an optional legend, and a button
// that swaps the chart for a table of the same numbers. Nothing is ever
// only readable by pointing at it.

import { useId, useState, type ComponentType, type ReactNode } from "react";

export type LegendItem = {
  key: string;
  label: string;
  // A CSS colour, normally a token such as var(--series-1).
  color: string;
  shape?: "rect" | "line";
  // Status legends carry an icon as well as the colour.
  icon?: ComponentType<{ size?: number }>;
};

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="legend__item">
          {item.icon ? (
            <span className="legend__icon" style={{ color: item.color }}>
              <item.icon size={14} />
            </span>
          ) : (
            <span
              className={`legend__key legend__key--${item.shape ?? "rect"}`}
              style={{ background: item.color }}
              aria-hidden="true"
            />
          )}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  children,
  busy = false,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  // The same numbers as a table (the accessible twin of the chart).
  table: ReactNode;
  children: ReactNode;
  busy?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <figure className={`card chart ${className}`} aria-labelledby={titleId} aria-busy={busy || undefined}>
      <div className="chart__head">
        <div className="chart__heading">
          <h2 className="card__title" id={titleId}>
            {title}
          </h2>
          {subtitle ? <p className="chart__subtitle">{subtitle}</p> : null}
        </div>
        <div className="chart__actions">
          {actions}
          <button
            type="button"
            className="button button--ghost button--small"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>
      {legend && !asTable ? <Legend items={legend} /> : null}
      <div className={`chart__body${busy ? " is-busy" : ""}`}>
        {asTable ? <div className="chart__table table-scroll">{table}</div> : children}
      </div>
    </figure>
  );
}

/** A tooltip placed near a point inside a chart, kept within the chart's box. */
export function ChartTooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  // The chart's width, so the tooltip never spills over its edge.
  width: number;
  children: ReactNode;
}) {
  const boxWidth = 200;
  const left = Math.max(0, Math.min(width - boxWidth, x - boxWidth / 2));
  return (
    <div className="chart-tip" style={{ left, top: Math.max(0, y) }} role="status">
      {children}
    </div>
  );
}

export function TipRow({ color, value, label }: { color?: string; value: string; label: string }) {
  return (
    <div className="chart-tip__row">
      {color ? <span className="chart-tip__key" style={{ background: color }} aria-hidden="true" /> : null}
      <span className="chart-tip__value">{value}</span>
      <span className="chart-tip__label">{label}</span>
    </div>
  );
}
