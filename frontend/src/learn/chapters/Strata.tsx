import { Link } from "react-router";

import { PipelineDiagram } from "../illustrations/Illustrations";
import { PipelineLab } from "../labs/PipelineLab";
import { Callout, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const STRATA_SOURCES = [] as const;

const PHASES: { phase: string; what: string; done?: boolean }[] = [
  { phase: "1", what: "Foundation: settings, secrets, logging, database, API, Docker", done: true },
  { phase: "1b", what: "This dashboard, logins and HTTPS", done: true },
  { phase: "1c", what: "Charts from real data, and this Learn section", done: true },
  { phase: "2", what: "Market data: one way in for prices, with checks for bad data", done: true },
  { phase: "3", what: "Indicators, analysis, market regimes" },
  { phase: "4", what: "Backtesting, with costs and out-of-sample results" },
  { phase: "5–6", what: "Analysis agents, the critic, the supervisor" },
  { phase: "7", what: "The risk engine and the kill switch" },
  { phase: "8", what: "Paper trading, order handling, close_all.py" },
  { phase: "9", what: "Trading views on this dashboard" },
  { phase: "10–12", what: "The real broker connection, security hardening, failure tests" },
  { phase: "13", what: "At least 30 days of paper trading, reviewed with the operator" },
  { phase: "14", what: "Preparing for live trading. STRATA never turns it on itself." },
];

export function StrataChapter() {
  const { setup } = useSetup();
  return (
    <>
      <p className="learn-lede">
        STRATA is built so that no single part, least of all an AI, can put money at risk on its own.
        This chapter follows an idea from a price to an order, and shows what stops it on the way.
      </p>

      <Section id="pipeline" title="The pipeline">
        <PipelineDiagram />
        <PipelineLab limits={setup.risk_limits} />
      </Section>

      <Section id="propose" title="Agents propose, rules decide">
        <p>
          The left half of the pipeline produces information. <Term id="agent">Agents</Term> each look
          at the market one way (technical signals, statistics, the market's regime, and, if the
          operator ever agrees, news and sentiment) and report a view with how sure they are and why.
          The <Term id="critic">critic</Term> looks for reasons not to trade, and can veto. The{" "}
          <Term id="supervisor">supervisor</Term> weighs everything into one structured proposal.
        </p>
        <p>
          The right half decides, with plain fixed rules and no AI. The{" "}
          <Term id="risk-engine">risk engine</Term> checks the proposal against every limit and can
          refuse it; nothing can override it. The execution engine only sends orders carrying the risk
          engine's approval, and checks the limits once more just before sending.
        </p>
        <Callout>
          The operator decided not to use an AI model for now (decision Q6): every agent will be
          ordinary, predictable code. If an AI model is ever added, it will only produce text for the
          agents to read, never orders.
        </Callout>
      </Section>

      <Section id="wrong" title="When something goes wrong">
        <p>
          How STRATA will handle trouble once it trades, and the phase that brings each part. Of
          these, the checks that refuse bad price data and the event and audit logs exist today.
        </p>
        <ul>
          <li><strong>Unsure means stop.</strong> Stale data, a broker that doesn't answer, or an order in an unknown state: STRATA doesn't trade until it knows. (Phases 2, 8)</li>
          <li><strong>Every start-up reconciles</strong> STRATA's records with Alpaca's before anything else. (Phase 8)</li>
          <li><strong>Orders can't be doubled</strong>: each has its own <Term id="client-order-id">client order ID</Term>. (Phase 8)</li>
          <li><strong>Limits stop the damage</strong>: the daily loss limit ends the day; the <Term id="kill-switch">kill switch</Term> ends everything until the operator resets it. (Phase 7)</li>
          <li><strong><span className="mono">close_all.py</span></strong> will cancel every order and close every position, for emergencies. (Phase 8)</li>
          <li><strong>Everything is written down</strong>: every decision with its reason, every event, and an <Term id="audit-log">audit log</Term> that can't be edited. (Phase 1, and every phase after)</li>
        </ul>
      </Section>

      <Section id="live" title="Real money needs four locks">
        <p>
          STRATA trades on paper by default. Live trading needs all four at once: the{" "}
          <span className="mono">--live</span> flag, <span className="mono">LIVE_TRADING=true</span>{" "}
          in the secrets file, live account keys, and the operator typing a confirmation phrase at the
          machine itself. No dashboard button, setting or agent can do it. The{" "}
          <Link to="/system">System page</Link> shows the locks.
        </p>
      </Section>

      <Section id="roadmap" title="What exists today">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">What it adds</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p.phase}>
                  <td className="mono">{p.phase}</td>
                  <td>{p.what}</td>
                  <td>{p.done ? "Done" : "Planned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Nothing in STRATA can place an order yet. The pages marked “Planned” in the menu show what
          each later phase will add.
        </p>
      </Section>

      <Section id="dashboard" title="Where to see it here">
        <ul>
          <li><Link to="/">Overview</Link>: is everything working, availability, sign-ins, the setup.</li>
          <li><Link to="/risk">Risk limits</Link>: every limit in dollars, and what a trade costs.</li>
          <li><Link to="/events">Events</Link> and <Link to="/audit">Audit log</Link>: what happened, and who did what.</li>
          <li><Link to="/system">System</Link>: the health history, your session, the live-trading locks.</li>
          <li><Link to="/learn/glossary">Glossary</Link>: every word and abbreviation used here.</li>
        </ul>
      </Section>
    </>
  );
}
