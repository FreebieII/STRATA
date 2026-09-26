// Scales and tick values for the dashboard's charts.

/** A round step for about `count` ticks from 0 to `max`: 1, 2 or 5 times a power of ten. */
export function niceStep(max: number, count = 4, integer = false): number {
  if (!(max > 0)) return 1;
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  const step = factor * magnitude;
  return integer ? Math.max(1, Math.round(step)) : step;
}

/** Ticks from 0 up to a round number at or above `max`. */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  const step = niceStep(max, count, integer);
  const top = max > 0 ? Math.ceil(max / step - 1e-9) * step : step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1e6; value += step) ticks.push(roundTo(value, step));
  return ticks;
}

function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals));
}

/** Map `value` from [d0, d1] onto [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Which of `count` labels to show so that at most `room` fit; the last one always shows. */
export function labelEvery(count: number, room: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, room)));
}

/** A bar's path: square at the baseline, the top corners rounded (the "data end"). */
export function columnPath(x: number, y: number, width: number, height: number, radius = 4): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottom = y + height;
  return (
    `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}` +
    `H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`
  );
}

export const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
