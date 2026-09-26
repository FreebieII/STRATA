// A line chart for the Learn section's illustrations: price lines, buy and
// sell markers, reference levels (such as RSI 30 and 70) and shaded spans
// (such as "holding"). Point at it, or focus it and use the arrow keys, to
// read each day; the readout below says the same in words.

import { useId, type KeyboardEvent, type PointerEvent } from "react";

import { linear, niceStep } from "../../charts/scale";
import { useWidth } from "../../charts/useWidth";

export type PlotLine = {
  key: string;
  label: string;
  values: (number | null)[];
  color: string;
  // Thinner, quieter lines for context (default 2 px).
  width?: number;
};

export type PlotMarker = { index: number; kind: "up" | "down" };
export type PlotSpan = { from: number; to: number };
export type PlotLevel = { value: number; label: string };

export function rangeTicks(min: number, max: number, count = 4): number[] {
  const step = niceStep(Math.max(max - min, 1e-9), count);
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = low; v <= high + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

const TOP = 10;
const BOTTOM = 22;
const LEFT = 44;
const RIGHT = 8;

export function Plot({
  lines,
  markers = [],
  spans = [],
  levels = [],
  height = 220,
  label,
  active,
  onActive,
  domain,
  format = (v: number) => v.toFixed(2),
  markerOn,
  showDays = true,
  hint = true,
}: {
  lines: PlotLine[];
  markers?: PlotMarker[];
  spans?: PlotSpan[];
  levels?: PlotLevel[];
  height?: number;
  label: string;
  active: number | null;
  onActive: (index: number | null) => void;
  // A fixed value range (RSI is 0-100); otherwise it fits the lines.
  domain?: [number, number];
  format?: (value: number) => string;
  // The line that markers sit on (default: the first).
  markerOn?: string;
  showDays?: boolean;
  // Say how to read the chart while nothing is pointed at (once per figure).
  hint?: boolean;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  const readoutId = useId();
  const count = Math.max(...lines.map((l) => l.values.length));
  const all = lines.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const ticks = domain
    ? rangeTicks(domain[0], domain[1], 4).filter((t) => t >= domain[0] && t <= domain[1])
    : rangeTicks(Math.min(...all), Math.max(...all), 4);
  const low = domain ? domain[0] : ticks[0]!;
  const high = domain ? domain[1] : ticks[ticks.length - 1]!;
  const base = height - BOTTOM;
  const plot = Math.max(60, width - LEFT - RIGHT);
  const step = plot / Math.max(1, count - 1);
  const x = (i: number) => LEFT + i * step;
  const y = linear(low, high, base, TOP);

  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.round((event.clientX - box.left - LEFT) / step);
    onActive(i >= 0 && i < count ? i : null);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const current = active ?? count - 1;
    const moves: Record<string, number> = {
      ArrowLeft: Math.max(0, current - 1),
      ArrowRight: Math.min(count - 1, current + 1),
      PageUp: Math.max(0, current - 10),
      PageDown: Math.min(count - 1, current + 10),
      Home: 0,
      End: count - 1,
    };
    if (event.key === "Escape") onActive(null);
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    onActive(to);
  };

  const onLine = lines.find((l) => l.key === markerOn) ?? lines[0];
  const readout =
    active === null
      ? hint
        ? "Point at the chart, or focus it and use the arrow keys, to read each day."
        : ""
      : `Day ${active + 1}: ` +
        lines
          .map((l) => {
            const v = l.values[active];
            return `${l.label} ${v === null || v === undefined ? "—" : format(v)}`;
          })
          .join(" · ");

  return (
    <div className="plot" ref={wrapper}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        aria-describedby={readoutId}
        tabIndex={0}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => onActive(null)}
        onKeyDown={onKey}
        onBlur={() => onActive(null)}
        className="plot__svg"
      >
        {spans.map((s) => (
          <rect key={`s${s.from}`} className="plot__span" x={x(s.from)} y={TOP} width={Math.max(1, x(s.to) - x(s.from))} height={base - TOP} />
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={LEFT} x2={width - RIGHT} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
            <text className="chart-tick" x={LEFT - 6} y={y(t) + 4} textAnchor="end">
              {(Number.isInteger(t) ? String(t) : t.toFixed(1)).replace("-", "−")}
            </text>
          </g>
        ))}
        {levels.map((level) => (
          <line
            key={level.label}
            className="plot__level"
            x1={LEFT}
            x2={width - RIGHT}
            y1={Math.round(y(level.value)) + 0.5}
            y2={Math.round(y(level.value)) + 0.5}
          />
        ))}
        {lines.map((l) => (
          <path key={l.key} className="plot__line" d={path(l.values)} style={{ stroke: l.color, strokeWidth: l.width ?? 2 }} />
        ))}
        {/* After the lines, so a label's halo keeps it readable where a line crosses it. */}
        {levels.map((level) => (
          <text key={level.label} className="plot__level-label" x={width - RIGHT - 4} y={y(level.value) - 4} textAnchor="end">
            {level.label}
          </text>
        ))}
        {onLine
          ? markers.map((m) => {
              const v = onLine.values[m.index];
              if (v === null || v === undefined) return null;
              const cx = x(m.index);
              const cy = m.kind === "up" ? y(v) + 12 : y(v) - 12;
              const d =
                m.kind === "up"
                  ? `M${cx},${cy - 6}L${cx + 6},${cy + 4}L${cx - 6},${cy + 4}Z`
                  : `M${cx},${cy + 6}L${cx + 6},${cy - 4}L${cx - 6},${cy - 4}Z`;
              return <path key={`m${m.index}${m.kind}`} className={`plot__marker plot__marker--${m.kind}`} d={d} />;
            })
          : null}
        {showDays
          ? [0, Math.floor((count - 1) / 2), count - 1].map((i) => (
              <text key={`d${i}`} className="chart-tick" x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"}>
                Day {i + 1}
              </text>
            ))
          : null}
        {active !== null ? (
          <>
            <line className="chart-cursor" x1={x(active) + 0.5} x2={x(active) + 0.5} y1={TOP} y2={base} />
            {lines.map((l) => {
              const v = l.values[active];
              return v === null || v === undefined ? null : (
                <circle key={l.key} className="plot__dot" cx={x(active)} cy={y(v)} r={4} style={{ fill: l.color }} />
              );
            })}
          </>
        ) : null}
      </svg>
      <p className={`plot__readout${active === null ? " plot__readout--hint" : ""}`} id={readoutId} aria-live="polite">
        {readout}
      </p>
    </div>
  );
}
