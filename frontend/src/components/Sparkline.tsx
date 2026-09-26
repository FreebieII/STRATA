// A small line chart of recent readings (for example a health check's
// latency). The newest reading is on the right; the scale starts at zero, so
// a line twice as high really is twice as slow.
//
// Point at it, or focus it and use the arrow keys, to read any single value.
// Nothing is hidden behind that: the latest, lowest and highest values are
// always written out, and the page offers the readings as a table too.

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatMs, formatTime } from "../lib/format";

export type SparkSample = { at: number; value: number | null; ok: boolean | null };

const PAD_X = 6; // room for the end marker
const PAD_TOP = 6;
const PAD_BOTTOM = 8; // room for failure ticks
const MARKER_R = 4; // 8px marker ...
const RING = 2; // ... with a 2px ring in the surface colour

export function Sparkline({
  samples,
  slots,
  label,
  height = 48,
  format = formatMs,
}: {
  samples: SparkSample[];
  // How many readings fit across; fewer samples fill in from the right.
  slots: number;
  label: string;
  height?: number;
  format?: (value: number) => string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [active, setActive] = useState<number | null>(null);
  const readoutId = useId();

  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return undefined;
    const measure = () => setWidth(Math.max(80, Math.round(element.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const values = samples.map((s) => s.value).filter((v): v is number => v !== null);
  const top = values.length ? Math.max(...values) * 1.2 : 1;
  const base = height - PAD_BOTTOM;
  const step = (width - PAD_X * 2) / Math.max(1, slots - 1);
  const offset = slots - samples.length;
  const x = (i: number) => PAD_X + (i + offset) * step;
  const y = (v: number) => base - (v / top) * (base - PAD_TOP);

  // Unbroken runs of readings become line segments; a missing reading is a gap.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  samples.forEach((s, i) => {
    if (s.value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v: s.value });
    }
  });
  if (run.length) runs.push(run);

  const line = (points: { i: number; v: number }[]) =>
    points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = (points: { i: number; v: number }[]) => {
    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last) return "";
    return `${line(points)}L${x(last.i).toFixed(1)},${base}L${x(first.i).toFixed(1)},${base}Z`;
  };

  const lastIndex = samples.length - 1;
  const shown = active ?? lastIndex;
  const shownSample = samples[shown];
  const failures = samples.filter((s) => s.ok === false).length;
  const gaps = samples.filter((s) => s.ok === null).length;

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    if (!samples.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const i = Math.round((event.clientX - box.left - PAD_X) / step) - offset;
    setActive(Math.min(lastIndex, Math.max(0, i)));
  };

  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!samples.length) return;
    const current = active ?? lastIndex;
    const moves: Record<string, number> = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: lastIndex,
    };
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(lastIndex, Math.max(0, next)));
  };

  let readout: string;
  if (!samples.length) {
    readout = "No readings yet.";
  } else if (active !== null && shownSample) {
    readout = `${formatTime(shownSample.at)} · ${describe(shownSample, format)}`;
  } else if (values.length) {
    const extras = [
      failures ? `${failures} failed` : "",
      gaps ? `${gaps} missed` : "",
    ].filter(Boolean);
    readout =
      `Low ${format(Math.min(...values))} · high ${format(Math.max(...values))}` +
      (extras.length ? ` · ${extras.join(", ")}` : "");
  } else {
    readout = failures ? `${failures} failed readings` : "No successful readings yet.";
  }

  return (
    <div className="spark" ref={wrapper}>
      <svg
        className="spark__plot"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={samples.length ? 0 : -1}
        role="img"
        aria-label={`${label}: ${samples.length} readings, newest on the right.`}
        aria-describedby={readoutId}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <line className="spark__baseline" x1={PAD_X} x2={width - PAD_X} y1={base + 0.5} y2={base + 0.5} />
        {runs.map((points) => (
          <path key={`a${points[0]?.i}`} className="spark__area" d={area(points)} />
        ))}
        {runs.map((points) =>
          points.length > 1 ? (
            <path key={`l${points[0]?.i}`} className="spark__line" d={line(points)} />
          ) : (
            <circle key={`d${points[0]?.i}`} className="spark__dot" cx={x(points[0]!.i)} cy={y(points[0]!.v)} r={2} />
          ),
        )}
        {samples.map((s, i) =>
          s.ok === false ? (
            <rect key={`f${i}`} className="spark__fail" x={x(i) - 1} y={base - 5} width={2} height={7} rx={1} />
          ) : s.ok === null ? (
            <rect key={`g${i}`} className="spark__gap" x={x(i) - 1} y={base - 3} width={2} height={5} rx={1} />
          ) : null,
        )}
        {active !== null && shownSample ? (
          <line className="spark__cursor" x1={x(shown) + 0.5} x2={x(shown) + 0.5} y1={PAD_TOP - 4} y2={base} />
        ) : null}
        {shownSample && shownSample.value !== null ? (
          <circle
            className="spark__marker"
            cx={x(shown)}
            cy={y(shownSample.value)}
            r={MARKER_R}
            strokeWidth={RING}
          />
        ) : null}
      </svg>
      <p className="spark__readout" id={readoutId} aria-live="polite">
        {readout}
      </p>
    </div>
  );
}

function describe(sample: SparkSample, format: (value: number) => string): string {
  if (sample.value !== null) return format(sample.value);
  return sample.ok === false ? "check failed" : "no reading (API not reachable)";
}
