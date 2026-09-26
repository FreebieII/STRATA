import { SplitTimeline } from "../illustrations/Illustrations";
import { Callout, Cite, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const TESTING_SOURCES = ["sec-marketing", "finra-2210", "ecfr-4-41", "alpaca-paper"] as const;

// 17 CFR 4.41(b)(1)(i): the statement the CFTC requires next to simulated results.
export const CFTC_STATEMENT =
  "These results are based on simulated or hypothetical performance results that have certain inherent limitations. Unlike the results shown in an actual performance record, these results do not represent actual trading. Also, because these trades have not actually been executed, these results may have under-or over-compensated for the impact, if any, of certain market factors, such as lack of liquidity. Simulated or hypothetical trading programs in general are also subject to the fact that they are designed with the benefit of hindsight. No representation is being made that any account will or is likely to achieve profits or losses similar to these being shown.";

export function TestingChapter() {
  const { setup } = useSetup();
  const b = setup.backtest;
  return (
    <>
      <p className="learn-lede">
        Anyone can find rules that would have made money in the past. The hard part is telling a real
        pattern from luck, and being honest about the difference.
      </p>

      <Section id="backtest" title="What a backtest is">
        <p>
          A <Term id="backtest">backtest</Term> runs a strategy's rules over past prices, day by day,
          as if it had been trading then, and records every simulated trade. It is quick and free,
          which is why it is also dangerous: you can try a thousand ideas and keep the one that looks
          best by chance.
        </p>
      </Section>

      <Section id="split" title="Keeping part of the past unseen">
        <p>
          The main defence is to split history in two. The <Term id="in-sample">in-sample</Term>{" "}
          period may be looked at while building. The <Term id="out-of-sample">out-of-sample</Term>{" "}
          period is kept unseen, and used once, to test settings that were fixed before. Results that
          hold up out-of-sample are worth more; results that don't were probably luck.
        </p>
        <SplitTimeline start={b.start_date} testStart={b.test_start_date} end={b.end_date} />
        <p>
          <Term id="walk-forward">Walk-forward testing</Term> repeats the idea through history: choose
          on one stretch, test on the next, move forward, again. Every result then comes from data the
          settings never saw.
        </p>
      </Section>

      <Section id="traps" title="How backtests lie">
        <ul>
          <li>
            <strong><Term id="overfitting">Overfitting</Term></strong>: settings tuned so closely to
            the past that they capture its noise. The more knobs, and the more tries, the worse it
            gets.
          </li>
          <li>
            <strong><Term id="look-ahead-bias">Look-ahead bias</Term></strong>: using information
            that wasn't known at the time, such as trading at a day's close using that same close to
            decide.
          </li>
          <li>
            <strong><Term id="survivorship-bias">Survivorship bias</Term></strong>: testing only on
            what still exists, which hides everything that failed along the way.
          </li>
          <li>
            <strong>Ignoring costs</strong>: fees, <Term id="bid-ask-spread">spreads</Term> and{" "}
            <Term id="slippage">slippage</Term> turn many “profitable” ideas into losing ones,
            especially ones that trade often.
          </li>
          <li>
            <strong>Bad data</strong>: gaps, duplicates and wrong prices produce trades that could
            never have happened.
          </li>
        </ul>
        <Callout>
          STRATA's strategy settings were written down before any test ({setup.strategies.ma_crossover.fast_period}/
          {setup.strategies.ma_crossover.slow_period} days; RSI {setup.strategies.rsi_reversion.rsi_period},{" "}
          {setup.strategies.rsi_reversion.buy_below}/{setup.strategies.rsi_reversion.sell_above}) and
          won't be changed after seeing out-of-sample results. Every simulated fill pays the costs in
          config.yaml; market data is checked for gaps and bad prices before use; and each result
          records the data, dates, strategy version and code version that produced it (Phases 2 and 4).
        </Callout>
      </Section>

      <Section id="metrics" title="The numbers a backtest reports">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">What it tells you</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="strong">Total return</td><td>How much the money grew or shrank over the whole period.</td></tr>
              <tr><td className="strong"><Term id="cagr">CAGR</Term></td><td>The same, as a steady yearly rate, so periods of different lengths compare.</td></tr>
              <tr><td className="strong">Maximum <Term id="drawdown">drawdown</Term></td><td>The worst fall from a peak: how painful it was to hold.</td></tr>
              <tr><td className="strong"><Term id="win-rate">Win rate</Term></td><td>The share of trades that made money. Meaningless without the size of wins and losses.</td></tr>
              <tr><td className="strong">Number of trades</td><td>Too few and the results are mostly luck; many and costs add up.</td></tr>
              <tr><td className="strong">Longest losing streak</td><td>How many losses in a row to expect, and sit through.</td></tr>
              <tr><td className="strong"><Term id="sharpe">Sharpe ratio</Term></td><td>Return per unit of bumpiness. Useful, but blind to rare disasters.</td></tr>
              <tr><td className="strong">vs <Term id="buy-and-hold">buy and hold</Term></td><td>Whether any of the effort beat doing nothing.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="regulators" title="Why regulators distrust backtests">
        <p>
          Backtested results are “hypothetical performance”: no portfolio actually achieved them. The
          SEC lets investment advisers advertise them only with procedures making sure they suit the
          intended audience's finances and goals, and with the assumptions, risks and limitations
          explained<Cite id="sec-marketing" />. FINRA's position is that brokers may not show
          backtested performance to retail investors<Cite id="finra-2210" />. The CFTC requires this statement next to any simulated results
          <Cite id="ecfr-4-41" />:
        </p>
        <blockquote className="callout">{CFTC_STATEMENT}</blockquote>
        <p>STRATA is none of these firms, but the warning applies to every backtest it will ever show you.</p>
      </Section>

      <Section id="paper" title="Paper trading, and its limits">
        <p>
          <Term id="paper-trading">Paper trading</Term> runs the strategy live, on real prices, with
          pretend money. It tests what backtests can't: the code, the timing, the broker, the
          reconciliation. But Alpaca's paper account is kinder than reality: orders fill against
          real-time quotes at full size, whatever was really on offer, and it doesn't simulate
          slippage, market impact, the queue for limit orders, regulatory fees or dividends
          <Cite id="alpaca-paper" />.
        </p>
        <Callout>
          STRATA will report paper results with the same cost estimates as its backtests, so paper
          trading doesn't flatter itself. And it must paper trade for at least 30 days in a row, with
          every trade reviewed, before live trading could even be considered: see the go-live
          checklist in the README.
        </Callout>
      </Section>
    </>
  );
}
