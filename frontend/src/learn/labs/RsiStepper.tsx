// Strategies: the RSI worked out for one day at a time, every number shown.

import { useState } from "react";

import { rsiSignals } from "../indicators";
import { Plot } from "../illustrations/Plot";
import { RANGING } from "../synthetic";
import { Lab, Slider } from "./Lab";
import { rsiSteps } from "./sim";

const n2 = (n: number) => n.toFixed(2);
const n3 = (n: number) => n.toFixed(3);

export function RsiStepper({ period, buyBelow, sellAbove }: { period: number; buyBelow: number; sellAbove: number }) {
  const steps = rsiSteps(RANGING, period);
  const line = steps.map((s) => s?.rsi ?? null);
  const signals = rsiSignals(line, buyBelow, sellAbove);
  const first = period;
  const last = RANGING.length - 1;
  const [day, setDay] = useState(signals[0]?.index ?? first);
  const step = steps[Math.min(Math.max(day, first), last)];
  if (!step) return null;

  const signal = signals.find((s) => s.index === step.index);
  const holdingBefore = signals.filter((s) => s.index < step.index).at(-1)?.kind === "up";
  const verdict =
    signal?.kind === "up"
      ? `Below ${buyBelow} while holding nothing: a buy signal. Today's close made it, so the strategy buys the next day.`
      : signal?.kind === "down"
        ? `Above ${sellAbove} while holding: a sell signal. The strategy sells the next day.`
        : step.rsi < buyBelow
          ? `Below ${buyBelow}, but it already holds: nothing more to do.`
          : step.rsi > sellAbove
            ? `Above ${sellAbove}, but it holds nothing: nothing to sell.`
            : `Between ${buyBelow} and ${sellAbove}: the strategy does nothing today${holdingBefore ? ", and keeps holding" : ""}.`;
  const nextSignal = signals.find((s) => s.index > step.index);

  return (
    <Lab
      title="The RSI, worked out for one day"
      kind="made-up"
      intro="Choose a day on the chart or with the slider to see every step of its RSI, with the numbers filled in."
    >
      <Plot
        label={`RSI (${period}) of made-up prices, with levels at ${buyBelow} and ${sellAbove}`}
        lines={[{ key: "rsi", label: "RSI", values: line, color: "var(--series-2)" }]}
        levels={[
          { value: sellAbove, label: `${sellAbove}: sell above` },
          { value: buyBelow, label: `${buyBelow}: buy below` },
        ]}
        markers={signals}
        domain={[0, 100]}
        height={150}
        active={step.index}
        onActive={(i) => {
          if (i !== null) setDay(Math.max(first, i));
        }}
        format={(v) => v.toFixed(1)}
        hint={false}
      />
      <div className="lab-controls">
        <Slider label="Day" value={step.index} min={first} max={last} onChange={setDay} format={(n) => `day ${n + 1}`} />
        <button
          type="button"
          className="button button--small button--ghost"
          disabled={!nextSignal}
          onClick={() => nextSignal && setDay(nextSignal.index)}
        >
          Next signal
        </button>
      </div>

      <ol className="lab-working" aria-live="polite">
        <li>
          <span className="lab-working__step">Today's change</span>
          <span className="mono">
            {n2(RANGING[step.index]!)} − {n2(RANGING[step.index - 1]!)} = {step.change >= 0 ? "+" : "−"}
            {n2(Math.abs(step.change))}
          </span>
          <span className="lab-working__why">the close today minus the close the day before</span>
        </li>
        <li>
          <span className="lab-working__step">Gain and loss</span>
          <span className="mono">
            gain {n2(step.gain)}, loss {n2(step.loss)}
          </span>
          <span className="lab-working__why">a rise counts as a gain, a fall as a loss; the other is zero</span>
        </li>
        <li>
          <span className="lab-working__step">Average gain</span>
          <span className="mono">
            {step.first || step.previousAvgGain === null
              ? `the first ${period} gains, averaged = ${n3(step.avgGain)}`
              : `(${n3(step.previousAvgGain)} × ${period - 1} + ${n2(step.gain)}) ÷ ${period} = ${n3(step.avgGain)}`}
          </span>
          <span className="lab-working__why">
            {step.first ? "the first RSI day starts from a plain average" : `yesterday's average keeps ${period - 1} parts in ${period}; today's gain adds the last part`}
          </span>
        </li>
        <li>
          <span className="lab-working__step">Average loss</span>
          <span className="mono">
            {step.first || step.previousAvgLoss === null
              ? `the first ${period} losses, averaged = ${n3(step.avgLoss)}`
              : `(${n3(step.previousAvgLoss)} × ${period - 1} + ${n2(step.loss)}) ÷ ${period} = ${n3(step.avgLoss)}`}
          </span>
          <span className="lab-working__why">worked out the same way</span>
        </li>
        <li>
          <span className="lab-working__step">RS</span>
          <span className="mono">
            {step.rs === null ? "no losses at all, so RSI is 100" : `${n3(step.avgGain)} ÷ ${n3(step.avgLoss)} = ${n3(step.rs)}`}
          </span>
          <span className="lab-working__why">how big the rises have been compared with the falls</span>
        </li>
        <li>
          <span className="lab-working__step">RSI</span>
          <span className="mono">
            {step.rs === null ? "100" : `100 − 100 ÷ (1 + ${n3(step.rs)}) = ${step.rsi.toFixed(1)}`}
          </span>
          <span className="lab-working__why">squeezes RS onto a scale from 0 to 100</span>
        </li>
      </ol>
      <p className="lab__result" aria-live="polite">
        <strong>Day {step.index + 1}: RSI {step.rsi.toFixed(1)}.</strong> {verdict}
      </p>
    </Lab>
  );
}
