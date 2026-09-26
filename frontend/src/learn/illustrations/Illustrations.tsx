// The Learn section's pictures. Made-up prices are always labelled as an
// illustration; pictures that show real settings (the backtest dates, the
// costs) or plain arithmetic say so instead.

import { useId, useState, type ReactNode } from "react";

import { Legend, type LegendItem } from "../../charts/ChartFrame";
import { linear } from "../../charts/scale";
import { useWidth } from "../../charts/useWidth";
import { crossovers, drawdown, longOnly, recoveryNeeded, rsi, rsiSignals, sma, type Cross } from "../indicators";
import { EQUITY, RANGING, TRENDING, TRENDING_SIDEWAYS_FROM } from "../synthetic";
import { Plot, type PlotSpan } from "./Plot";

/** A frame for a picture, with what kind of picture it is. */
export function Figure({
  title,
  kind,
  caption,
  legend,
  children,
}: {
  title: string;
  // "illustration": made-up numbers. "settings": STRATA's real settings.
  // "arithmetic": exact maths, no data. "facts": real times, worked out now.
  // "diagram": how STRATA is built.
  kind: "illustration" | "settings" | "arithmetic" | "facts" | "diagram";
  caption: ReactNode;
  legend?: LegendItem[];
  children: ReactNode;
}) {
  const tag = {
    illustration: "Illustration: made-up prices, not market data",
    settings: "From STRATA's settings",
    arithmetic: "Arithmetic, not data",
    facts: "Real times, worked out for today",
    diagram: "How STRATA is built",
  }[kind];
  const titleId = useId();
  return (
    <figure className="learn-figure" aria-labelledby={titleId}>
      <div className="learn-figure__head">
        <p className="learn-figure__title" id={titleId}>
          {title}
        </p>
        <span className={`learn-figure__tag learn-figure__tag--${kind}`}>{tag}</span>
      </div>
      {legend ? <Legend items={legend} /> : null}
      {children}
      <figcaption className="learn-figure__caption">{caption}</figcaption>
    </figure>
  );
}

const SIGNAL_LEGEND: LegendItem[] = [
  { key: "up", label: "Buy signal ▲", color: "var(--ink)" },
  { key: "down", label: "Sell signal ▼", color: "var(--ink)" },
];

/** Holding periods: from each buy signal to the next sell signal. */
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function holdingSpans(signals: Cross[], lastIndex: number): PlotSpan[] {
  const spans: PlotSpan[] = [];
  let from: number | null = null;
  for (const s of signals) {
    if (s.kind === "up" && from === null) from = s.index;
    if (s.kind === "down" && from !== null) {
      spans.push({ from, to: s.index });
      from = null;
    }
  }
  if (from !== null) spans.push({ from, to: lastIndex });
  return spans;
}

export function CrossoverIllustration({ fast = 20, slow = 50 }: { fast?: number; slow?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const fastLine = sma(TRENDING, fast);
  const slowLine = sma(TRENDING, slow);
  const signals = longOnly(crossovers(fastLine, slowLine));
  const spans = holdingSpans(signals, TRENDING.length - 1);
  const held = spans.reduce((sum, s) => sum + s.to - s.from, 0);
  const whipsaws = signals.filter((s) => s.index >= TRENDING_SIDEWAYS_FROM).length;
  return (
    <Figure
      title={`Moving-average crossover, ${fast} and ${slow} days`}
      kind="illustration"
      legend={[
        { key: "price", label: "Price", color: "var(--series-1)", shape: "line" },
        { key: "fast", label: `${fast}-day average`, color: "var(--series-2)", shape: "line" },
        { key: "slow", label: `${slow}-day average`, color: "var(--series-3)", shape: "line" },
        ...SIGNAL_LEGEND,
      ]}
      caption={
        signals.length ? (
          <>
            The shaded stretches are when the strategy would hold: it buys when the {fast}-day
            average rises above the {slow}-day one (a “golden cross”) and sells when it falls back
            below (a “death cross”). Averages lag, so each buy comes after a rise has begun and each
            sell after a fall has begun.
            {whipsaws ? ` In the sideways stretch at the end they cross ${times(whipsaws)}: whipsaws.` : ""}{" "}
            {signals.length} {signals.length === 1 ? "signal" : "signals"} in all; held for {held} of{" "}
            {TRENDING.length} days.
          </>
        ) : (
          <>
            With a {slow}-day average, this made-up history of {TRENDING.length} days is too short to
            show a signal.
          </>
        )
      }
    >
      <Plot
        label={`Made-up prices with ${fast}- and ${slow}-day moving averages and ${signals.length} crossover signals`}
        lines={[
          { key: "price", label: "price", values: TRENDING, color: "var(--series-1)", width: 1.5 },
          { key: "fast", label: `${fast}-day average`, values: fastLine, color: "var(--series-2)" },
          { key: "slow", label: `${slow}-day average`, values: slowLine, color: "var(--series-3)" },
        ]}
        markers={signals}
        markerOn="fast"
        spans={spans}
        active={active}
        onActive={setActive}
      />
    </Figure>
  );
}

export function RsiIllustration({
  period = 14,
  buyBelow = 30,
  sellAbove = 70,
}: {
  period?: number;
  buyBelow?: number;
  sellAbove?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const line = rsi(RANGING, period);
  const signals = rsiSignals(line, buyBelow, sellAbove);
  const spans = holdingSpans(signals, RANGING.length - 1);
  // Each signal is acted on the next day: a signal needs that day's close.
  const next = (day: number) => RANGING[Math.min(day + 1, RANGING.length - 1)]!;
  const trades = spans.filter((span) => span.from + 1 < RANGING.length).map((span) => next(span.to) / next(span.from) - 1);
  const won = trades.filter((r) => r > 0).length;
  const open = signals.length % 2 === 1;
  return (
    <Figure
      title={`RSI mean reversion: ${period} days, buy below ${buyBelow}, sell above ${sellAbove}`}
      kind="illustration"
      legend={[
        { key: "price", label: "Price", color: "var(--series-1)", shape: "line" },
        { key: "rsi", label: `RSI (${period})`, color: "var(--series-2)", shape: "line" },
        ...SIGNAL_LEGEND,
      ]}
      caption={
        <>
          The top chart is the price, the bottom one its RSI. When RSI drops below {buyBelow}, prices
          have fallen hard and fast, and the strategy buys, betting on a bounce; when RSI climbs above{" "}
          {sellAbove}, it sells. That works while prices swing around a level. In a long fall RSI can
          stay low for weeks, and buying early loses money.{" "}
          {trades.length
            ? `Here: ${trades.length} ${trades.length === 1 ? "trade" : "trades"}, ${won} made money and ${trades.length - won} lost${open ? " (the last is still open at the end)" : ""}.`
            : "With these settings, this made-up history has no signal."}
        </>
      }
    >
      <Plot
        label="Made-up prices that swing up and down, with RSI buy and sell signals"
        lines={[{ key: "price", label: "price", values: RANGING, color: "var(--series-1)" }]}
        markers={signals}
        spans={spans}
        active={active}
        onActive={setActive}
        height={180}
        showDays={false}
        hint={false}
      />
      <Plot
        label={`RSI of the same prices, with levels at ${buyBelow} and ${sellAbove}`}
        lines={[{ key: "rsi", label: "RSI", values: line, color: "var(--series-2)" }]}
        levels={[
          { value: sellAbove, label: `${sellAbove}: sell above` },
          { value: buyBelow, label: `${buyBelow}: buy below` },
        ]}
        domain={[0, 100]}
        spans={spans}
        active={active}
        onActive={setActive}
        height={150}
        format={(v) => v.toFixed(0)}
      />
    </Figure>
  );
}

export function DrawdownIllustration() {
  const [active, setActive] = useState<number | null>(null);
  const dd = drawdown(EQUITY);
  const worst = Math.min(...dd);
  return (
    <Figure
      title="Drawdown: how far below its best the account is"
      kind="illustration"
      caption={
        <>
          Top: the value of a made-up $300 account. Bottom: its drawdown, the fall from the highest
          value so far. The worst here is {worst.toFixed(1).replace("-", "−")}%. A strategy's maximum drawdown says
          how painful it would have been to hold on; expect it to be worse in real trading than in
          a backtest.
        </>
      }
    >
      <Plot
        label="A made-up account value over time"
        lines={[{ key: "equity", label: "account value $", values: EQUITY, color: "var(--series-1)" }]}
        active={active}
        onActive={setActive}
        height={170}
        showDays={false}
        hint={false}
      />
      <Plot
        label={`Its drawdown, worst ${worst.toFixed(1)}%`}
        lines={[{ key: "dd", label: "drawdown %", values: dd, color: "var(--series-2)" }]}
        levels={[{ value: -20, label: "−20%: STRATA's drawdown limit" }]}
        domain={[Math.min(-25, Math.floor(worst / 5) * 5), 0]}
        active={active}
        onActive={setActive}
        height={130}
        format={(v) => `${v.toFixed(1)}%`}
      />
    </Figure>
  );
}

/** How big a gain makes up for a loss, with STRATA's account-wide limits marked. */
export function RecoveryCurve({ dailyPct, totalPct }: { dailyPct: number; totalPct: number }) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  const height = 220;
  const left = 48;
  const bottom = 30;
  const top = 12;
  const maxLoss = 75;
  const maxGain = 300;
  const x = linear(0, maxLoss, left, width - 12);
  const y = linear(0, maxGain, height - bottom, top);
  let d = "";
  for (let loss = 0; loss <= maxLoss; loss += 0.5) d += `${loss ? "L" : "M"}${x(loss).toFixed(1)},${y(recoveryNeeded(loss)).toFixed(1)}`;
  const pct = (n: number) => `${+n.toFixed(n < 10 ? 1 : 0)}%`;
  const compact = width < 560;
  // Marks at STRATA's limits, and at 50%. Each label sits in the empty space
  // above the curve, on its own row, joined to its point by a thin line.
  const marks = [
    { loss: dailyPct, note: "the daily loss limit" },
    { loss: totalPct, note: "the kill switch" },
    { loss: 50, note: "" },
  ]
    .filter((m, i, all) => m.loss > 0 && m.loss <= 65 && all.findIndex((o) => o.loss === m.loss) === i)
    .sort((a, b) => a.loss - b.loss);
  return (
    <Figure
      title="The gain you need to get back to even"
      kind="arithmetic"
      caption={
        <>
          After losing {pct(dailyPct)} you need a {pct(recoveryNeeded(dailyPct))} gain to get back;
          after {pct(totalPct)}, {pct(recoveryNeeded(totalPct))}; after 50%, 100%. Losses compound
          against you, which is why STRATA stops early: its daily loss limit is {pct(dailyPct)} of
          its capital, and its kill switch trips at {pct(totalPct)}. Small losses are easy to recover
          from; big ones may never be.
        </>
      }
    >
      <div ref={wrapper}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Gain needed to recover from a loss: ${marks.map((m) => `${pct(m.loss)} needs ${pct(recoveryNeeded(m.loss))}`).join(", ")}`}
        >
          {[0, 100, 200, 300].map((t) => (
            <g key={t}>
              <line className={t ? "chart-grid" : "chart-baseline"} x1={left} x2={width - 12} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
              <text className="chart-tick" x={left - 6} y={y(t) + 4} textAnchor="end">
                {t}%
              </text>
            </g>
          ))}
          {[0, 25, 50, 75].map((t) => (
            <text
              key={t}
              className="chart-tick"
              x={x(t)}
              y={height - 12}
              textAnchor={t === 0 ? "start" : t === maxLoss ? "end" : "middle"}
            >
              lose {t}%
            </text>
          ))}
          <path className="chart-line" d={d} />
          {marks.map((m, i) => {
            const px = x(m.loss);
            const py = y(recoveryNeeded(m.loss));
            const row = top + 14 + i * 22;
            // On a narrow screen the caption names the limits, and the labels just give the sums.
            const text = compact
              ? `−${pct(m.loss)} → +${pct(recoveryNeeded(m.loss))}`
              : `−${pct(m.loss)} needs +${pct(recoveryNeeded(m.loss))}${m.note ? ` (${m.note})` : ""}`;
            // Start the label at its line; if it would run off the right, end it there;
            // if that runs off the left too, keep it inside the chart.
            const w = text.length * 6.2;
            const textX = px + 6 + w <= width - 12 ? px + 6 : px - 6 - w >= 4 ? px - 6 - w : Math.max(4, width - 12 - w);
            return (
              <g key={m.loss}>
                <line className="chart-leader" x1={Math.round(px) + 0.5} x2={Math.round(px) + 0.5} y1={row + 4} y2={py - 6} />
                <circle className="chart-marker" cx={px} cy={py} r={4} strokeWidth={2} />
                <text className="plot__level-label" x={textX} y={row}>
                  {text}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </Figure>
  );
}

// Three made-up trades, in units of the stop distance (R): +2R is the target,
// -1R the stop. Scaled by the stop, the picture is right for any STOP_LOSS_PCT.
const TRADE_PATHS = {
  target: [0, 0.2, -0.1, 0.4, 0.7, 0.5, 1, 1.3, 1.1, 1.6, 1.8, 2],
  stop: [0, 0.1, -0.2, -0.04, -0.4, -0.5, -0.36, -0.7, -0.6, -0.84, -1],
  gap: [0, -0.1, 0.1, -0.2, -0.4, -0.5, -0.72, -1.5],
};

/** A stop-loss, and a take-profit twice as far, on three made-up trades. */
export function StopTargetIllustration({ stopPct = 5, positionUsd = 60 }: { stopPct?: number; positionUsd?: number }) {
  const target = stopPct * 2;
  const price = (r: number) => +(100 + r * stopPct).toFixed(2);
  const gapOpen = price(-1.5);
  const trades = [
    {
      title: "Reaches the target",
      note: `+${target}%: +$${((positionUsd * target) / 100).toFixed(2)}, twice the risk (+2R)`,
      path: TRADE_PATHS.target.map(price),
    },
    {
      title: "Hits the stop",
      note: `−${stopPct}%: −$${((positionUsd * stopPct) / 100).toFixed(2)}, the planned risk (−1R)`,
      path: TRADE_PATHS.stop.map(price),
    },
    {
      title: "Jumps past the stop",
      note: `The price opened at ${gapOpen}, below the stop: −${+(100 - gapOpen).toFixed(2)}%, more than planned`,
      path: TRADE_PATHS.gap.map(price),
    },
  ];
  return (
    <Figure
      title={`Stop-loss ${stopPct}% below, take-profit ${target}% above`}
      kind="illustration"
      caption={
        <>
          Every STRATA position will have both from the moment it is bought. The target is twice as
          far as the stop, so one win makes up for two losses, before costs. A stop can't guarantee its price: if
          the price jumps past it (overnight, or on news), the sale happens at the next price there is.
        </>
      }
    >
      <div className="trade-grid">
        {trades.map((trade) => (
          <MiniTrade key={trade.title} {...trade} stop={price(-1)} target={price(2)} />
        ))}
      </div>
    </Figure>
  );
}

function MiniTrade({ title, note, path, stop, target }: { title: string; note: string; path: number[]; stop: number; target: number }) {
  const [wrapper, width] = useWidth<HTMLDivElement>(220);
  const height = 150;
  // The level labels get a column of their own on the right, clear of the price.
  const gutter = 70;
  const x = linear(0, 11, 8, width - gutter);
  const margin = (target - stop) * 0.1;
  const y = linear(Math.min(stop, ...path) - margin, Math.max(target, ...path) + margin, height - 8, 8);
  const d = path.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = path[path.length - 1]!;
  const levels = [
    { v: target, label: `target ${target}` },
    { v: 100, label: "bought 100" },
    { v: stop, label: `stop ${stop}` },
  ];
  return (
    <div className="trade" ref={wrapper}>
      <p className="trade__title">{title}</p>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${note}`}>
        {levels.map((l) => (
          <line
            key={l.label}
            className={l.v === 100 ? "chart-baseline" : "plot__level"}
            x1={8}
            x2={width - gutter + 6}
            y1={Math.round(y(l.v)) + 0.5}
            y2={Math.round(y(l.v)) + 0.5}
          />
        ))}
        <path className="chart-line" d={d} />
        {levels.map((l) => (
          <text key={l.label} className="plot__level-label" x={width - gutter + 12} y={y(l.v) + 4}>
            {l.label}
          </text>
        ))}
        <circle className="chart-marker" cx={x(path.length - 1)} cy={y(last)} r={4} strokeWidth={2} />
      </svg>
      <p className="trade__note">{note}</p>
    </div>
  );
}

/** The parts of one day's price bar (a "candle"), in the classic black-and-white style. */
export function CandleDiagram() {
  const candle = (cx: number, open: number, close: number, high: number, low: number, up: boolean) => {
    const top = Math.min(open, close);
    const bodyHeight = Math.abs(close - open);
    return (
      <g>
        <line className="candle__wick" x1={cx} x2={cx} y1={high} y2={low} />
        <rect className={up ? "candle__body candle__body--up" : "candle__body candle__body--down"} x={cx - 14} y={top} width={28} height={bodyHeight} rx={2} />
      </g>
    );
  };
  return (
    <Figure
      title="One day's price bar (a candle)"
      kind="illustration"
      caption={
        <>
          Each bar sums up a day: the price it opened at, the highest and lowest prices traded, and
          where it closed. A hollow body means it closed higher than it opened; a filled body, lower.
          Price data in this form is called OHLC (open, high, low, close), or OHLCV with the volume
          traded. STRATA's strategies use the daily close.
        </>
      }
    >
      <svg className="candles" viewBox="0 0 420 200" role="img" aria-label="Two candles: one closing higher than it opened, one lower, with open, close, high and low labelled">
        {candle(110, 140, 70, 40, 165, true)}
        {candle(290, 70, 140, 45, 170, false)}
        <g className="candle__labels">
          <text x={130} y={44}>high</text>
          <text x={130} y={74}>close</text>
          <text x={130} y={144}>open</text>
          <text x={130} y={168}>low</text>
          <text x={62} y={196} textAnchor="middle">closed higher</text>
          <text x={310} y={49}>high</text>
          <text x={310} y={74}>open</text>
          <text x={310} y={144}>close</text>
          <text x={310} y={173}>low</text>
          <text x={242} y={196} textAnchor="middle">closed lower</text>
        </g>
      </svg>
    </Figure>
  );
}

/** A quote: the best prices to buy and to sell at. */
export function SpreadDiagram() {
  const asks = [
    { price: "100.03", size: 200 },
    { price: "100.02", size: 150 },
    { price: "100.01", size: 300 },
  ];
  const bids = [
    { price: "100.00", size: 250 },
    { price: "99.99", size: 400 },
    { price: "99.98", size: 100 },
  ];
  const row = (side: "ask" | "bid", item: { price: string; size: number }, best: boolean) => (
    <div className={`book__row book__row--${side}${best ? " is-best" : ""}`} key={side + item.price}>
      <span className="book__price mono">${item.price}</span>
      <span className="book__track">
        <span className="book__bar" style={{ width: `${(item.size / 400) * 100}%` }} />
      </span>
      <span className="book__count mono">{item.size} shares</span>
      <span className="book__note">{best ? (side === "ask" ? "best ask: you buy here" : "best bid: you sell here") : null}</span>
    </div>
  );
  return (
    <Figure
      title="Bid, ask and the spread"
      kind="illustration"
      caption={
        <>
          Sellers offer shares at asking prices (top), buyers bid (bottom). A market order to buy
          pays the lowest ask, $100.01; one to sell gets the highest bid, $100.00. The gap between
          them, 1 cent here, is the spread: a cost of trading that busy markets keep small.
        </>
      }
    >
      <div className="book" role="img" aria-label="Order book: asks at 100.03, 100.02, 100.01; bids at 100.00, 99.99, 99.98; spread 1 cent">
        <p className="book__side">Asks (offers to sell)</p>
        {asks.map((a, i) => row("ask", a, i === asks.length - 1))}
        <p className="book__spread">spread: $0.01</p>
        {bids.map((b, i) => row("bid", b, i === 0))}
        <p className="book__side">Bids (offers to buy)</p>
      </div>
    </Figure>
  );
}

// --- times --------------------------------------------------------------------------

function offsetMs(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant;
}

/** The moment it is `hour:minute` on `day` (YYYY-MM-DD) in `timeZone`. */
export function zonedTime(day: string, hour: number, minute: number, timeZone: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

const NEW_YORK = "America/New_York";

function newYorkDay(instant: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK }).format(new Date(instant));
}

function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isWeekday(day: string): boolean {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export type Session = { key: "pre" | "regular" | "after"; label: string; start: number; end: number };

/**
 * The US sessions (Eastern Time), as moments, of every New York weekday from
 * `before` days before `now` to `after` days after. Weekends are skipped;
 * market holidays aren't known.
 */
export function usSessions(now: number = Date.now(), before = 1, after = 1): Session[] {
  const today = newYorkDay(now);
  const sessions: Session[] = [];
  for (let i = -before; i <= after; i++) {
    const day = addDays(today, i);
    if (!isWeekday(day)) continue;
    const at = (h: number, m: number) => zonedTime(day, h, m, NEW_YORK);
    sessions.push(
      { key: "pre", label: "Pre-market", start: at(4, 0), end: at(9, 30) },
      { key: "regular", label: "Regular session", start: at(9, 30), end: at(16, 0) },
      { key: "after", label: "After hours", start: at(16, 0), end: at(20, 0) },
    );
  }
  return sessions;
}


export function SessionClock({
  now = Date.now(),
  resetZone,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
}: {
  now?: number;
  resetZone: string;
  // The viewer's time zone (the browser's, unless a test sets it).
  timeZone?: string;
}) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  // A week ahead is enough to find the next session after any weekend.
  const sessions = usSessions(now, 1, 7);
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(now));
  const start = zonedTime(localDay, 0, 0, timeZone);
  const end = zonedTime(addDays(localDay, 1), 0, 0, timeZone);
  const left = 110;
  const x = linear(start, end, left, width - 10);
  const clamp = (t: number) => Math.max(start, Math.min(end, t));
  const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
  const dayName = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone });
  const tz = timeZone;
  // Your day, from your midnight to the next: a New York session may cross it.
  const inDay = (s: Session) => s.end > start && s.start < end;
  const today = sessions.find((s) => s.key === "regular" && inDay(s));
  const next = sessions.find((s) => s.key === "regular" && s.start > now);
  const span = (s: Session) => `${clock.format(s.start)}–${clock.format(s.end)}`;
  const rows: { label: string; parts: { key: string; from: number; to: number }[] }[] = [
    {
      label: "US stocks",
      parts: sessions.filter(inDay).map((s) => ({ key: s.key, from: clamp(s.start), to: clamp(s.end) })),
    },
    { label: "Crypto", parts: [{ key: "crypto", from: start, to: end }] },
  ];
  const when = today
    ? `today that is ${span(today)} where you are`
    : `none falls on your ${dayName.format(now)}${next ? `; the next is on ${dayName.format(next.start)}, ${span(next)} where you are` : ""}`;
  return (
    <Figure
      title={`When markets trade, in your time zone (${tz})`}
      kind="facts"
      legend={[
        { key: "regular", label: "US regular session", color: "var(--series-1)" },
        { key: "ext", label: "US pre-market and after hours", color: "var(--series-1-track)" },
        { key: "crypto", label: "Crypto: all day, every day", color: "var(--series-3)" },
      ]}
      caption={
        <>
          The US regular session runs 9:30 to 16:00 New York time, on weekdays that aren't market
          holidays: {when}. (This picture skips weekends but doesn't know the holidays.) Fewer people
          trade before and after the session, so prices are thinner and spreads wider. Crypto never
          closes. STRATA's daily limits reset at midnight in {resetZone}.
        </>
      }
    >
      <div ref={wrapper}>
        <svg width={width} height={96} viewBox={`0 0 ${width} 96`} role="img" aria-label={`US regular session: ${when}. Crypto trades all day.`}>
          {rows.map((row, r) => (
            <g key={row.label}>
              <text className="chart-tick" x={0} y={24 + r * 30}>
                {row.label}
              </text>
              <rect className="session__track" x={left} y={12 + r * 30} width={width - 10 - left} height={16} rx={3} />
              {row.parts.length ? null : (
                <text className="chart-tick" x={left + 8} y={24 + r * 30}>
                  closed all day
                </text>
              )}
              {row.parts.map((p, i) => (
                <rect
                  key={`${p.key}${i}`}
                  x={x(p.from)}
                  y={12 + r * 30}
                  width={Math.max(1, x(p.to) - x(p.from))}
                  height={16}
                  rx={3}
                  style={{
                    fill:
                      p.key === "regular" ? "var(--series-1)" : p.key === "crypto" ? "var(--series-3)" : "var(--series-1-track)",
                  }}
                />
              ))}
            </g>
          ))}
          {[0, 6, 12, 18, 24].map((h) => (
            <text
              key={h}
              className="chart-tick"
              x={x(h === 24 ? end : zonedTime(localDay, h, 0, timeZone))}
              y={88}
              textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}
            >
              {String(h).padStart(2, "0")}:00
            </text>
          ))}
          <line className="chart-cursor" x1={x(now)} x2={x(now)} y1={6} y2={72} />
          <text className="plot__level-label" x={x(now) + 4} y={8}>
            now
          </text>
        </svg>
      </div>
    </Figure>
  );
}

// --- STRATA's own settings ---------------------------------------------------------------

const dayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function SplitTimeline({ start, testStart, end }: { start: string; testStart: string; end: string | null }) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  const t1 = Date.parse(`${testStart}T00:00:00Z`);
  const t2 = end ? Date.parse(`${end}T00:00:00Z`) : Date.now();
  const x = linear(t0, t2, 0, width);
  const years = (a: number, b: number) => ((b - a) / (365.25 * 86_400_000)).toFixed(1);
  return (
    <Figure
      title="How STRATA's backtests split the past"
      kind="settings"
      legend={[
        { key: "in", label: "In-sample: may be looked at while building", color: "var(--series-1)" },
        { key: "out", label: "Out-of-sample: kept unseen, reported separately", color: "var(--series-2)" },
      ]}
      caption={
        <>
          From config.yaml: {years(t0, t1)} years in-sample ({dayFormat.format(t0)} to the day before{" "}
          {dayFormat.format(t1)}), then {years(t1, t2)} years out-of-sample, up to{" "}
          {end ? dayFormat.format(t2) : "the latest data"}. The strategies' settings were fixed before
          any test, and are not changed after seeing out-of-sample results.
        </>
      }
    >
      <div ref={wrapper}>
        <svg width={width} height={54} viewBox={`0 0 ${width} 54`} role="img" aria-label={`In-sample ${start} to ${testStart}; out-of-sample from ${testStart}`}>
          <rect x={0} y={4} width={Math.max(1, x(t1) - 1)} height={18} rx={3} style={{ fill: "var(--series-1)" }} />
          <rect x={x(t1) + 1} y={4} width={Math.max(1, width - x(t1) - 1)} height={18} rx={3} style={{ fill: "var(--series-2)" }} />
          <text className="chart-tick" x={0} y={40}>
            {dayFormat.format(t0)}
          </text>
          <text className="chart-tick" x={x(t1)} y={40} textAnchor="middle">
            {dayFormat.format(t1)}
          </text>
          <text className="chart-tick" x={width} y={40} textAnchor="end">
            {end ? dayFormat.format(t2) : "today"}
          </text>
        </svg>
      </div>
    </Figure>
  );
}

type PipelineStep = { name: string; does: string; phase: string };

const INFORM: PipelineStep[] = [
  { name: "Market data", does: "prices, checked for gaps and bad values", phase: "Phase 2" },
  { name: "Analysis agents", does: "technical, quantitative, regime…", phase: "Phases 3, 5" },
  { name: "Strategy", does: "MA crossover or RSI: a buy or sell idea", phase: "Phases 4, 5" },
  { name: "Critic", does: "looks for reasons not to", phase: "Phase 5" },
  { name: "Supervisor", does: "weighs it all: a trade proposal", phase: "Phase 6" },
];

const DECIDE: PipelineStep[] = [
  { name: "Risk engine", does: "every limit, no exceptions", phase: "Phase 7" },
  { name: "Execution", does: "sends the order once, checks it filled", phase: "Phase 8" },
  { name: "Broker", does: "Alpaca, paper account", phase: "Phases 8, 10" },
];

export function PipelineDiagram() {
  const group = (steps: PipelineStep[], start: number, gate: boolean) => (
    <ol className="pipeline" start={start}>
      {steps.map((step) => (
        <li key={step.name} className={`pipeline__step${gate ? " pipeline__step--gate" : ""}`}>
          <span className="pipeline__name">{step.name}</span>
          <span className="pipeline__does">{step.does}</span>
          <span className="pipeline__phase mono">{step.phase}</span>
        </li>
      ))}
    </ol>
  );
  return (
    <Figure
      title="From a price to an order"
      kind="diagram"
      caption={
        <>
          The first group only produces information; nothing in it can place an order. The second is
          plain, fixed rules with no AI: the risk engine can refuse anything, and the execution
          engine only sends orders the risk engine approved. Every step is stored and logged with
          its reason.
        </>
      }
    >
      <p className="pipeline__group">Information only: none of these can place an order</p>
      {group(INFORM, 1, false)}
      <p className="pipeline__group">The only way to an order: fixed rules, no AI</p>
      {group(DECIDE, INFORM.length + 1, true)}
    </Figure>
  );
}
