// The risk limits from config.yaml, what they mean in dollars, and the rules
// the operator chose for the risk engine (Phase 7). Every number here comes
// from the API; the arithmetic only restates it.

import { useSystemStatus } from "../api/SystemStatusContext";
import type { RiskLimitsSummary } from "../api/types";
import { IconInfo, IconLock } from "../components/Icons";
import { Meter, Pips } from "../components/Meter";
import { Card, ErrorNotice, Notice, PageHeader, RefreshControl } from "../components/Parts";
import { formatPct, formatUsd } from "../lib/format";

export type RiskFigures = {
  capital: number;
  position: number;
  lossPerStop: number;
  stopsPerDay: number;
  stopsInTotal: number;
};

export function riskFigures(limits: RiskLimitsSummary): RiskFigures {
  const lossPerStop = (limits.max_position_value * limits.STOP_LOSS_PCT) / 100;
  const count = (budget: number) => (lossPerStop > 0 ? Math.floor(budget / lossPerStop + 1e-9) : 0);
  return {
    capital: limits.MAX_CAPITAL,
    position: limits.max_position_value,
    lossPerStop,
    stopsPerDay: count(limits.DAILY_LOSS_LIMIT),
    stopsInTotal: count(limits.TOTAL_LOSS_LIMIT),
  };
}

const share = (part: number, whole: number) => (whole > 0 ? part / whole : 0);

export function RiskPage() {
  const { status } = useSystemStatus();
  const limits = status.data?.trading.risk_limits;

  return (
    <>
      <PageHeader title="Risk limits" description="How much the bot may use and lose, from config.yaml.">
        <RefreshControl updatedAt={status.updatedAt} refreshing={status.refreshing} onRefresh={status.refresh} />
      </PageHeader>

      {status.error ? <ErrorNotice error={status.error} title="Couldn't get the limits" /> : null}
      {!limits && status.loading ? <p className="loading">Loading…</p> : null}

      <Notice tone="neutral" icon={<IconInfo size={18} />} title="Not enforced yet: nothing can trade before Phase 7">
        The risk engine that checks every order against these limits arrives in Phase 7, before
        any trading exists. Orders that break a limit will be refused even if a strategy asks for
        them.
      </Notice>

      {limits ? <Limits limits={limits} busy={Boolean(status.error)} /> : null}

      <Card title="Rules decided for the risk engine" className="spaced">
        <p className="card__lede">
          Chosen by the operator on 25 September 2026 (BUILD_PLAN.md, section 6). They take effect
          when the risk engine is built.
        </p>
        <ol className="rules">
          <li>
            <strong>Both sets of limits apply.</strong> The dollar limits above, and matching
            percentages: 1% of capital at risk per trade, 5% daily loss, 20% drawdown. Limits on
            open positions, exposure, correlation, leverage (1.0) and a minimum reward-to-risk are
            added on top.
          </li>
          <li>
            <strong>Selling to cut risk is always allowed.</strong> When a limit blocks new buys,
            sells that only reduce risk, such as a stop-loss, still go through, and are logged.
          </li>
          <li>
            <strong>The kill switch closes everything, then stops.</strong> It cancels open orders,
            sells open positions and refuses to trade until the operator resets it by hand.
          </li>
          <li>
            <strong>No day trades.</strong> A stock that hits its stop on the day it was bought is
            sold at the next session.
          </li>
          <li>
            <strong>Exits.</strong> A position closes on the strategy’s sell signal, at the stop, or
            at a profit target twice as far as the stop (5% stop, 10% target). A trade is only
            proposed if its reward is at least 1.5 times its risk.
          </li>
          <li>
            <strong>Long only, always.</strong> No leverage, margin, short selling or options.
          </li>
        </ol>
      </Card>
    </>
  );
}

function Limits({ limits, busy }: { limits: RiskLimitsSummary; busy: boolean }) {
  const f = riskFigures(limits);
  return (
    <div className="grid grid--risk">
      <Card title="Capital" busy={busy}>
        <p className="hero-figure">{formatUsd(f.capital)}</p>
        <p className="card__lede">
          The most the bot may ever have invested. Everything else is measured against it.
        </p>
      </Card>

      <Card title="Each limit as a share of the capital" busy={busy}>
        <div className="meters">
          <Meter
            label="Largest single position"
            value={formatUsd(f.position)}
            fraction={share(f.position, f.capital)}
            detail={`${formatPct(limits.MAX_POSITION_PCT)} of capital`}
          />
          <Meter
            label="Total loss limit (kill switch)"
            value={formatUsd(limits.TOTAL_LOSS_LIMIT)}
            fraction={share(limits.TOTAL_LOSS_LIMIT, f.capital)}
            detail={`${formatPct(share(limits.TOTAL_LOSS_LIMIT, f.capital) * 100)} of capital; then everything stops until reset by hand`}
          />
          <Meter
            label="Daily loss limit"
            value={formatUsd(limits.DAILY_LOSS_LIMIT)}
            fraction={share(limits.DAILY_LOSS_LIMIT, f.capital)}
            detail={`${formatPct(share(limits.DAILY_LOSS_LIMIT, f.capital) * 100)} of capital; then no new trades until the next day`}
          />
          <Meter
            label="Loss when one position hits its stop"
            value={formatUsd(f.lossPerStop)}
            fraction={share(f.lossPerStop, f.capital)}
            detail={`${formatPct(limits.STOP_LOSS_PCT)} of a ${formatUsd(f.position)} position = ${formatPct(share(f.lossPerStop, f.capital) * 100)} of capital`}
          />
        </div>
      </Card>

      <Card title="Losing trades each limit allows" busy={busy} className="span-2">
        <div className="budgets">
          <div className="budget">
            <p className="budget__figure">{f.stopsPerDay}</p>
            <div>
              <p className="budget__label">stop-outs in a day before the daily limit</p>
              <Pips count={f.stopsPerDay} label={`${f.stopsPerDay} stop-outs`} />
            </div>
          </div>
          <div className="budget">
            <p className="budget__figure">{f.stopsInTotal}</p>
            <div>
              <p className="budget__label">stop-outs in total before the kill switch</p>
              <Pips count={f.stopsInTotal} label={`${f.stopsInTotal} stop-outs`} />
            </div>
          </div>
          <div className="budget">
            <p className="budget__figure">{limits.MAX_TRADES_PER_DAY}</p>
            <div>
              <p className="budget__label">trades allowed per day, at most</p>
              <Pips count={limits.MAX_TRADES_PER_DAY} label={`${limits.MAX_TRADES_PER_DAY} trades`} />
            </div>
          </div>
        </div>
        <p className="card__note">
          <IconLock size={14} /> A stop-out here is a {formatUsd(f.position)} position sold{" "}
          {formatPct(limits.STOP_LOSS_PCT)} below its entry, before fees and slippage. Prices can
          jump past a stop, so real losses can use up a limit sooner.
        </p>
      </Card>
    </div>
  );
}
