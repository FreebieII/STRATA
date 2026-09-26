// Testing: try many random strategies on prices with no pattern, keep the best
// backtest, and watch it fail on the part of the past it never saw.

import { useMemo, useState } from "react";

import { useWidth } from "../../charts/useWidth";
import { linear } from "../../charts/scale";
import { Legend } from "../../charts/ChartFrame";
import { Plot } from "../illustrations/Plot";
import { Term } from "../Prose";
import { Lab, Readout, signedPct } from "./Lab";
import { overfitExperiment, overfitSurvey, rankAfterwards, type OverfitExperiment } from "./sim";

const COUNT = 100;
const SURVEY = Array.from({ length: 20 }, (_, i) => i + 1);

/** 1st, 2nd, 3rd, 4th, ..., 11th, 12th, 13th, 21st, 22nd, ... */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export function OverfitLab() {
  const [market, setMarket] = useState(8);
  const [tried, setTried] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const experiment = useMemo(() => overfitExperiment(market, COUNT), [market]);
  const { best, split, prices } = experiment;
  const tail = prices.length - split;
  const rank = rankAfterwards(experiment);
  // Many markets at once, worked out only once asked for.
  const survey = useMemo(() => (tried ? overfitSurvey(SURVEY, COUNT) : null), [tried]);

  return (
    <Lab
      title="The overfitting machine"
      kind="made-up"
      intro={`These made-up prices move by chance alone: there is no pattern to find. Try ${COUNT} random crossover settings on the first ${split} days, keep the one with the best backtest, then see how it does on the last ${tail}.`}
      note={
        <>
          Every setting here is tested on a <Term id="random-walk">random walk</Term>, so any profit is
          luck. Real prices aren't purely random, which makes luck harder to spot, not easier.
        </>
      }
    >
      <Legend
        items={[
          { key: "price", label: "Price", color: "var(--series-1)", shape: "line" },
          { key: "unseen", label: `Kept unseen: the last ${tail} days`, color: "var(--series-1-track)" },
        ]}
      />
      <Plot
        label={`Made-up market number ${market}: ${prices.length} days of random prices`}
        lines={[{ key: "price", label: "price", values: prices, color: "var(--series-1)", width: 1.5 }]}
        spans={[{ from: split, to: prices.length - 1 }]}
        height={150}
        active={active}
        onActive={setActive}
      />
      <div className="lab-controls">
        <button type="button" className="button button--small button--primary" onClick={() => setTried(true)} disabled={tried}>
          Try {COUNT} random strategies
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            setMarket((m) => m + 1);
            setActive(null);
          }}
        >
          A new made-up market
        </button>
        <span className="lab-stepper__where mono">market #{market}</span>
      </div>

      {tried ? (
        <>
          <Scatter experiment={experiment} />
          <div className="lab-readouts" aria-live="polite">
            <Readout label="Best backtest" value={signedPct(best.inSamplePct)} detail={`averages of ${best.fast} and ${best.slow} days, first ${split} days`} />
            <Readout label="The same setting, afterwards" value={signedPct(best.outSamplePct)} detail={`the last ${tail} days, never seen`} />
            <Readout label="A typical setting, afterwards" value={signedPct(experiment.medianOutPct)} detail={`the median of all ${COUNT}`} />
          </div>
          <p className="lab__explain">
            The best of {COUNT} made {signedPct(best.inSamplePct)} on the days it was chosen on. On the
            days it never saw it made {signedPct(best.outSamplePct)}, {ordinal(rank)} of the {COUNT}.
            {survey
              ? ` Over ${survey.markets} made-up markets, the best backtest beat a typical setting afterwards in ${survey.winnerAhead} of them (luck alone would give about ${survey.markets / 2}), and once came as low as ${ordinal(survey.worstRank)} of ${COUNT}.`
              : null}{" "}
            A great backtest, found by trying many settings, doesn't tell you a setting will keep
            working. That is <Term id="overfitting">overfitting</Term>, and it is why STRATA fixed its
            settings before any test and keeps its <Term id="out-of-sample">out-of-sample</Term> period
            for the end.
          </p>
        </>
      ) : null}
    </Lab>
  );
}

/** Each setting as a dot: its backtest (across) against how it did afterwards (up). */
function Scatter({ experiment }: { experiment: OverfitExperiment }) {
  const [wrapper, width] = useWidth<HTMLDivElement>(640);
  const height = 240;
  const left = 46;
  const bottom = 34;
  const xs = experiment.runs.map((r) => r.inSamplePct);
  const ys = experiment.runs.map((r) => r.outSamplePct);
  const pad = (lo: number, hi: number) => {
    const span = Math.max(hi - lo, 1);
    return [Math.min(lo, 0) - span * 0.08, Math.max(hi, 0) + span * 0.08] as const;
  };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const x = linear(x0, x1, left, width - 12);
  const y = linear(y0, y1, height - bottom, 12);
  const { best } = experiment;
  const label = `${experiment.runs.length} settings. The best backtest, ${best.fast}/${best.slow}, made ${signedPct(best.inSamplePct)}, then ${signedPct(best.outSamplePct)} afterwards.`;

  return (
    <div ref={wrapper} className="lab-chart">
      <Legend
        items={[
          { key: "run", label: "One random setting", color: "var(--series-1)" },
          { key: "best", label: "The best backtest", color: "var(--series-2)" },
        ]}
      />
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <line className="chart-baseline" x1={x(0)} x2={x(0)} y1={12} y2={height - bottom} />
        <line className="chart-baseline" x1={left} x2={width - 12} y1={y(0)} y2={y(0)} />
        <text className="chart-tick" x={width - 12} y={height - 8} textAnchor="end">
          backtest (first part) →
        </text>
        <text className="chart-tick" x={left - 6} y={16} textAnchor="end">
          later ↑
        </text>
        <text className="chart-tick" x={x(0)} y={height - bottom + 14} textAnchor="middle">
          0%
        </text>
        <text className="chart-tick" x={left - 6} y={y(0) + 4} textAnchor="end">
          0%
        </text>
        {experiment.runs.map((r) =>
          r === best ? null : (
            <circle key={`${r.fast}/${r.slow}`} className="lab-dot" cx={x(r.inSamplePct)} cy={y(r.outSamplePct)} r={4}>
              <title>{`${r.fast}/${r.slow}: backtest ${signedPct(r.inSamplePct)}, afterwards ${signedPct(r.outSamplePct)}`}</title>
            </circle>
          ),
        )}
        <circle className="lab-dot lab-dot--best" cx={x(best.inSamplePct)} cy={y(best.outSamplePct)} r={6} strokeWidth={2}>
          <title>{`Best backtest ${best.fast}/${best.slow}: ${signedPct(best.inSamplePct)}, afterwards ${signedPct(best.outSamplePct)}`}</title>
        </circle>
        <text className="plot__level-label" x={x(best.inSamplePct) - 10} y={y(best.outSamplePct) - 10} textAnchor="end">
          best backtest
        </text>
      </svg>
    </div>
  );
}
