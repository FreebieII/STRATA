import { Link } from "react-router";

import { DrawdownIllustration, RecoveryCurve, StopTargetIllustration } from "../illustrations/Illustrations";
import { SizingLab } from "../labs/SizingLab";
import { Callout, Cite, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const RISK_SOURCES = [
  "investor-stop-order",
  "investor-stop-bulletin",
  "investor-margin",
  "investor-diversification",
  "investor-compound",
] as const;

export function RiskChapter() {
  const { setup } = useSetup();
  const r = setup.risk_limits;
  const perStop = (r.max_position_value * r.STOP_LOSS_PCT) / 100;
  const perStopPct = +((perStop / r.MAX_CAPITAL) * 100).toFixed(2);
  return (
    <>
      <p className="learn-lede">
        Nobody controls whether a trade wins. What you can control is how much you lose when it
        doesn't. STRATA's first job is not making money but not losing much.
      </p>

      <Section id="arithmetic" title="Why small losses matter so much">
        <p>
          Losses and gains aren't symmetric. Lose 50% and you need a 100% gain just to get back to
          where you started. Returns <Term id="compounding">compound</Term>, and so do losses
          <Cite id="investor-compound" />.
        </p>
        <RecoveryCurve
          dailyPct={(r.DAILY_LOSS_LIMIT / r.MAX_CAPITAL) * 100}
          totalPct={(r.TOTAL_LOSS_LIMIT / r.MAX_CAPITAL) * 100}
        />
      </Section>

      <Section id="sizing" title="How much to put in one trade">
        <p>
          <Term id="position-size">Position sizing</Term> decides how much one bad trade can cost.
          STRATA may use at most ${r.MAX_CAPITAL} (<span className="mono">MAX_CAPITAL</span>) and put
          at most {r.MAX_POSITION_PCT}% of it, ${r.max_position_value}, into any one position (
          <span className="mono">MAX_POSITION_PCT</span>).
        </p>
        <SizingLab limits={r} />
      </Section>

      <Section id="stops" title="Stop-loss and take-profit">
        <p>
          A <Term id="stop-loss">stop-loss</Term> sells a position once its price falls a set amount
          below what was paid. STRATA's is {r.STOP_LOSS_PCT}% (<span className="mono">STOP_LOSS_PCT</span>),
          so a ${r.max_position_value} position risks about ${perStop.toFixed(2)}, {perStopPct}% of the capital.
          A <Term id="take-profit">take-profit</Term> sells once the price is up a set amount:
          STRATA's is twice the stop distance, {r.STOP_LOSS_PCT * 2}%. Measured in units of risk,
          called <Term id="r-multiple">R</Term>, a win is +2R and a loss −1R. STRATA only proposes
          trades whose <Term id="risk-reward">reward is at least 1.5 times the risk</Term>.
        </p>
        <StopTargetIllustration stopPct={r.STOP_LOSS_PCT} positionUsd={r.max_position_value} />
        <p>
          A stop is not a guarantee. When its price is reached it becomes a market order, and in a
          fast market the sale can happen well below the stop<Cite id="investor-stop-order" />. If
          the price <Term id="gap">gaps</Term> past it, overnight or on news, the sale happens at the
          next price there is<Cite id="investor-stop-bulletin" />.
        </p>
      </Section>

      <Section id="limits" title="STRATA's limits, together">
        <div className="table-scroll">
          <table className="table">
            <caption className="table__caption">From config.yaml; enforced by the risk engine from Phase 7</caption>
            <thead>
              <tr>
                <th scope="col">Limit</th>
                <th scope="col">Value</th>
                <th scope="col">What happens</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">MAX_CAPITAL</td>
                <td>${r.MAX_CAPITAL}</td>
                <td>Never more than this invested.</td>
              </tr>
              <tr>
                <td className="mono">MAX_POSITION_PCT</td>
                <td>{r.MAX_POSITION_PCT}% (${r.max_position_value})</td>
                <td>No single position larger than this.</td>
              </tr>
              <tr>
                <td className="mono">STOP_LOSS_PCT</td>
                <td>{r.STOP_LOSS_PCT}%</td>
                <td>Every position is sold if it falls this far.</td>
              </tr>
              <tr>
                <td className="mono">DAILY_LOSS_LIMIT</td>
                <td>${r.DAILY_LOSS_LIMIT}</td>
                <td>No new buys until the day ends (midnight, {setup.timezone}).</td>
              </tr>
              <tr>
                <td className="mono">TOTAL_LOSS_LIMIT</td>
                <td>${r.TOTAL_LOSS_LIMIT}</td>
                <td>The <Term id="kill-switch">kill switch</Term>: sell everything and stop until reset by hand.</td>
              </tr>
              <tr>
                <td className="mono">MAX_TRADES_PER_DAY</td>
                <td>{r.MAX_TRADES_PER_DAY}</td>
                <td>At most this many orders a day, buys and sells both counting.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          When a limit stops new buys, sales that only reduce risk, such as a stop-loss, still go
          through (the operator's decision Q2). The <Link to="/risk">risk page</Link> shows how the
          limits fit together.
        </p>
      </Section>

      <Section id="drawdown" title="Drawdown">
        <p>
          <Term id="drawdown">Drawdown</Term> is how far an account is below its best value so far.
          The maximum drawdown, the deepest of those falls, answers “how bad did it get?”, and the
          operator chose a 20% drawdown limit for the risk engine (decision Q1).
        </p>
        <DrawdownIllustration />
      </Section>

      <Section id="never" title="What STRATA never does">
        <ul>
          <li>
            <strong>No borrowing</strong>: no <Term id="margin">margin</Term>, no{" "}
            <Term id="leverage">leverage</Term>. With borrowed money you can lose more than you put
            in<Cite id="investor-margin" />.
          </li>
          <li>
            <strong>No short selling</strong>: its losses have no ceiling.
          </li>
          <li><strong>No options</strong>, and nothing else outside the two instruments.</li>
        </ul>
      </Section>

      <Section id="diversification" title="Two instruments, not two bets">
        <p>
          <Term id="diversification">Diversification</Term> spreads risk so one loss may be offset by
          another, but it can't prevent losses when everything falls together
          <Cite id="investor-diversification" />. SPY and bitcoin sometimes fall together, so holding
          both is not as safe as it sounds. The risk engine will add a{" "}
          <Term id="correlation">correlation</Term> limit.
        </p>
        <Callout kind="careful" title="When unsure, don't">
          If data is stale, the broker doesn't answer, or an order's state is unknown, STRATA doesn't
          trade until it knows. Missing a good trade costs nothing; a trade based on a mistake can
          cost a lot.
        </Callout>
      </Section>
    </>
  );
}
