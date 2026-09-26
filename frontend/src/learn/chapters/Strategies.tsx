import { roundTrip } from "../../lib/costs";
import { CrossoverIllustration, RsiIllustration } from "../illustrations/Illustrations";
import { CrossoverLab } from "../labs/CrossoverLab";
import { RsiStepper } from "../labs/RsiStepper";
import { Callout, Cite, Formula, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const STRATEGIES_SOURCES = [
  "cme-moving-averages",
  "nasdaq-golden-cross",
  "nasdaq-death-cross",
  "cme-oscillators",
] as const;

export function StrategiesChapter() {
  const { setup } = useSetup();
  const ma = setup.strategies.ma_crossover;
  const r = setup.strategies.rsi_reversion;
  return (
    <>
      <p className="learn-lede">
        A <Term id="strategy">strategy</Term> is a fixed set of rules that turns prices into “buy”
        and “sell”. It is not a prediction, and nothing guarantees it will work. It is an idea
        precise enough to test.
      </p>

      <Section id="families" title="Two kinds of idea">
        <p>Most simple strategies are one of two opposite bets:</p>
        <ul>
          <li>
            <strong><Term id="trend-following">Trend following</Term></strong>: prices that have
            started moving tend to keep going. Buy what is rising, sell what is falling.
          </li>
          <li>
            <strong><Term id="mean-reversion">Mean reversion</Term></strong>: prices that have moved
            too far, too fast, tend to come back. Buy after a sharp fall, sell after a sharp rise.
          </li>
        </ul>
        <p>
          Both are right some of the time. Trend following does well in long trends and badly when
          prices go sideways; mean reversion the other way round. Which one a market is in, its{" "}
          <Term id="regime">regime</Term>, changes over time.
        </p>
      </Section>

      <Section id="moving-averages" title="Moving averages">
        <p>
          A <Term id="moving-average">simple moving average</Term> (SMA) of N days is the average of
          the last N closing prices, worked out again each day. It smooths out day-to-day noise. An{" "}
          <Term id="ema">exponential moving average</Term> (EMA) gives recent days more weight, so it
          reacts faster<Cite id="cme-moving-averages" />.
        </p>
        <Formula>{`SMA(N) today = (close today + close yesterday + … + close N−1 days ago) ÷ N`}</Formula>
        <p>
          A short average reacts quickly; a long one slowly. When the short one rises above the long
          one, the recent trend has turned up; generally a bullish sign. Falling below is bearish
          <Cite id="cme-moving-averages" />. With 50 and 200 days, these{" "}
          <Term id="crossover">crossovers</Term> are called the{" "}
          <Term id="golden-cross">golden cross</Term> and the{" "}
          <Term id="death-cross">death cross</Term>
          <Cite id="nasdaq-golden-cross" />
          <Cite id="nasdaq-death-cross" />.
        </p>
      </Section>

      <Section id="crossover" title={`STRATA's first strategy: ${ma.fast_period}/${ma.slow_period} moving-average crossover`}>
        <ul>
          <li>Buy when the {ma.fast_period}-day average of the daily close rises above the {ma.slow_period}-day average.</li>
          <li>Sell when it falls back below.</li>
          <li>Long only: when not holding, it is in cash.</li>
        </ul>
        <CrossoverIllustration fast={ma.fast_period} slow={ma.slow_period} />
        <CrossoverLab
          fast={ma.fast_period}
          slow={ma.slow_period}
          costPct={{
            stock: roundTrip(setup.costs.stock, setup.risk_limits.max_position_value).breakevenPct,
            crypto: roundTrip(setup.costs.crypto, setup.risk_limits.max_position_value).breakevenPct,
          }}
        />
        <p>
          <strong>Strengths:</strong> simple, and it stays in for the whole of a long trend.{" "}
          <strong>Weaknesses:</strong> averages lag, so it buys after a rise has started and sells
          after a fall has started; and when prices go sideways, the averages cross back and forth,
          each <Term id="whipsaw">whipsaw</Term> a small loss plus costs.
        </p>
      </Section>

      <Section id="rsi" title="The relative strength index (RSI)">
        <p>
          <Term id="rsi">RSI</Term>, introduced by J. Welles Wilder in 1978, compares the average
          size of recent up moves with recent down moves, on a scale from 0 to 100. Above 70 is
          generally read as overbought, below 30 as oversold<Cite id="cme-oscillators" />. For N
          days:
        </p>
        <Formula>{`1. Each day's change: close − previous close.
2. Average gain = average of the rises;  average loss = average of the falls (as positive numbers).
   After the first N days, each new average = (previous average × (N − 1) + today's value) ÷ N.
3. RS  = average gain ÷ average loss
4. RSI = 100 − 100 ÷ (1 + RS)`}</Formula>
        <p>
          If prices only rose, the average loss is zero and RSI is 100; if rises and falls balance,
          RSI is 50.
        </p>
        <RsiStepper period={r.rsi_period} buyBelow={r.buy_below} sellAbove={r.sell_above} />
      </Section>

      <Section id="rsi-strategy" title={`STRATA's second strategy: RSI mean reversion (${r.rsi_period}, ${r.buy_below}/${r.sell_above})`}>
        <ul>
          <li>Buy when the {r.rsi_period}-day RSI falls below {r.buy_below}.</li>
          <li>Sell when it rises above {r.sell_above}.</li>
          <li>Long only, one position at a time.</li>
        </ul>
        <RsiIllustration period={r.rsi_period} buyBelow={r.buy_below} sellAbove={r.sell_above} />
        <p>
          <strong>Strengths:</strong> it buys cheap and sells dear while prices swing around a level.{" "}
          <strong>Weaknesses:</strong> in a long fall, RSI can stay below {r.buy_below} for weeks: it
          buys early and keeps losing. That is exactly when the stop-loss matters.
        </p>
      </Section>

      <Section id="from-signal" title="From a signal to a trade">
        <Callout>
          In STRATA a signal is never an order. It becomes a proposal, which analysis agents and a
          critic weigh; the supervisor turns it into a structured trade proposal; and the risk engine
          checks it against every limit before anything is sent. Each instrument in config.yaml says
          which strategy it uses; today both use the moving-average crossover
          {setup.instruments.length ? ` (${setup.instruments.map((i) => `${i.symbol}: ${i.strategy}`).join(", ")})` : ""}.
        </Callout>
      </Section>

      <Section id="benchmark" title="The benchmark: doing nothing">
        <p>
          Any strategy has to beat the simplest alternative: <Term id="buy-and-hold">buying and
          holding</Term>. A strategy that makes 5% in a year when buying SPY and waiting made 20% has
          failed, however clever it looks. Every STRATA result is compared with buy-and-hold over
          the same period, after the same costs.
        </p>
        <Callout kind="careful" title="No strategy is proven">
          Neither strategy has been shown to make money. STRATA will test them honestly (next
          chapter) and report what it finds, including if the answer is “worse than buying and
          holding”. Past results, even honest ones, don't predict future results.
        </Callout>
      </Section>
    </>
  );
}
