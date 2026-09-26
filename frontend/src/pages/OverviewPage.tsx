// The first page after logging in: is everything working, what is set up,
// and what happened recently.

import { Link } from "react-router";

import { api } from "../api/client";
import { HISTORY_LENGTH, useSystemStatus, type Sample } from "../api/SystemStatusContext";
import type { CheckDetail, RiskLimitsSummary, SystemStatus, TradingSummary } from "../api/types";
import { useResource, type Resource } from "../api/useResource";
import type { AuditPage, EventPage } from "../api/types";
import { IconArrowRight, IconCritical, IconGood, IconLock, IconWarning } from "../components/Icons";
import { Card, ErrorNotice, KeyValues, PageHeader, RefreshControl, Time } from "../components/Parts";
import { Sparkline } from "../components/Sparkline";
import { HealthBadge, SeverityBadge, StatusBadge } from "../components/StatusBadge";
import { formatDuration, formatMs, formatPct, formatTime, formatUsd, humanise, shortCommit } from "../lib/format";

export const LIST_INTERVAL_MS = 30_000;

export function OverviewPage() {
  const { status, history, roundTrips } = useSystemStatus();
  const events = useResource("overview-events", (signal) => api.events({ limit: 8 }, signal), LIST_INTERVAL_MS);
  const audit = useResource("overview-audit", (signal) => api.audit({ limit: 6 }, signal), LIST_INTERVAL_MS);
  const data = status.data;
  const stale = Boolean(status.error && data);

  return (
    <>
      <PageHeader title="Overview" description="Health, setup and recent activity at a glance.">
        <RefreshControl
          updatedAt={status.updatedAt}
          refreshing={status.refreshing}
          every="15 s"
          onRefresh={() => {
            status.refresh();
            events.refresh();
            audit.refresh();
          }}
        />
      </PageHeader>

      {status.error ? <ErrorNotice error={status.error} title="Couldn't get the system status" /> : null}

      {data ? (
        <>
          <Verdict status={data} stale={stale} updatedAt={status.updatedAt} />
          <div className={`tiles${stale ? " is-busy" : ""}`}>
            <ApiTile status={data} answering={!status.error} roundTrips={roundTrips} />
            {data.checks.map((check) => (
              <CheckTile key={check.name} check={check} samples={history[check.name] ?? []} />
            ))}
          </div>
          <div className="grid grid--2">
            <TradingCard trading={data.trading} busy={stale} />
            <RiskCard limits={data.trading.risk_limits} busy={stale} />
          </div>
        </>
      ) : status.loading ? (
        <p className="loading">Loading the system status…</p>
      ) : null}

      <div className="grid grid--2">
        <RecentEvents resource={events} />
        <RecentAudit resource={audit} />
      </div>
    </>
  );
}

function Verdict({ status, stale, updatedAt }: { status: SystemStatus; stale: boolean; updatedAt: number | undefined }) {
  const failing = status.checks.filter((check) => !check.ok);
  const ok = failing.length === 0;
  return (
    <section className={`verdict verdict--${ok ? "good" : "critical"}${stale ? " is-busy" : ""}`} aria-live="polite">
      <span className="verdict__icon">{ok ? <IconGood size={28} /> : <IconCritical size={28} />}</span>
      <div className="verdict__text">
        <p className="verdict__title">{ok ? "Everything is working" : "Something needs attention"}</p>
        <p className="verdict__detail">
          {ok
            ? `All ${status.checks.length} health checks pass.`
            : failing.map((check) => `${humanise(check.name)}: ${check.detail}`).join(" · ")}
          {stale && updatedAt ? ` Last good reading at ${formatTime(updatedAt)}.` : ""}
        </p>
      </div>
    </section>
  );
}

function ApiTile({
  status,
  answering,
  roundTrips,
}: {
  status: SystemStatus;
  answering: boolean;
  roundTrips: Sample[];
}) {
  const commit = shortCommit(status.git_commit);
  const latest = roundTrips[roundTrips.length - 1];
  return (
    <section className={`tile${answering ? "" : " tile--failing"}`} aria-label="API">
      <div className="tile__head">
        <h2 className="tile__title">API</h2>
        {answering ? (
          <StatusBadge tone="good" label="Answering" />
        ) : (
          <StatusBadge tone="critical" label="Not answering" />
        )}
      </div>
      <p className="tile__figure">{latest?.latencyMs != null ? formatMs(latest.latencyMs) : "—"}</p>
      <p className="tile__caption">to answer this browser</p>
      <Sparkline
        label="API answer time"
        slots={HISTORY_LENGTH}
        samples={roundTrips.map((s) => ({ at: s.at, value: s.latencyMs, ok: s.ok }))}
      />
      <ReadingsTable name="API answer time" samples={roundTrips} />
      <p className="tile__foot">
        Up {formatDuration(status.uptime_s)} · <span className="mono">v{status.version}</span>
        {commit ? (
          <>
            {" "}
            · <span className="mono">{commit}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}

function CheckTile({ check, samples }: { check: CheckDetail; samples: Sample[] }) {
  const timed = check.latency_ms !== null || samples.some((s) => s.latencyMs !== null);
  const name = humanise(check.name);
  return (
    <section className={`tile${check.ok ? "" : " tile--failing"}`} aria-label={name}>
      <div className="tile__head">
        <h2 className="tile__title">{name}</h2>
        <HealthBadge ok={check.ok} />
      </div>
      {timed ? (
        <>
          <p className="tile__figure">{check.latency_ms !== null ? formatMs(check.latency_ms) : "—"}</p>
          <p className="tile__caption">response time</p>
          <Sparkline
            label={`${name} response time`}
            slots={HISTORY_LENGTH}
            samples={samples.map((s) => ({ at: s.at, value: s.latencyMs, ok: s.ok }))}
          />
          <ReadingsTable name={name} samples={samples} />
        </>
      ) : (
        <>
          <p className="tile__figure tile__figure--text">{check.ok ? "Up to date" : "Needs attention"}</p>
          {migration(check.detail) ? (
            <p className="tile__caption">
              migration <span className="mono">{migration(check.detail)}</span>
            </p>
          ) : null}
        </>
      )}
      <p className={`tile__foot${check.ok ? "" : " tile__foot--problem"}`}>{check.detail}</p>
    </section>
  );
}

/** "up to date (migration 0002)" -> "0002" */
function migration(detail: string): string | null {
  return /\(migration ([\w.-]+)\)/.exec(detail)?.[1] ?? null;
}

function ReadingsTable({ name, samples }: { name: string; samples: Sample[] }) {
  if (!samples.length) return null;
  return (
    <details className="readings">
      <summary>Readings as a table</summary>
      <table className="table table--compact">
        <caption className="sr-only">{name} response time, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col" className="num">
              Response
            </th>
          </tr>
        </thead>
        <tbody>
          {[...samples].reverse().map((s) => (
            <tr key={s.at}>
              <td className="mono">{formatTime(s.at)}</td>
              <td className="num mono">
                {s.latencyMs !== null ? formatMs(s.latencyMs) : s.ok === false ? "failed" : "no reading"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="readings__note">
        Taken by this page every 15 seconds while it is open; the last {HISTORY_LENGTH} are kept.
      </p>
    </details>
  );
}

function TradingCard({ trading, busy }: { trading: TradingSummary; busy: boolean }) {
  return (
    <Card
      title="Trading setup"
      busy={busy}
      action={
        <Link className="link-arrow" to="/system">
          System details <IconArrowRight size={14} />
        </Link>
      }
    >
      <KeyValues
        rows={[
          ["Mode", <span key="m"><strong>Paper</strong> — simulated money</span>],
          [
            "Live switch",
            trading.live_trading_switch ? (
              <StatusBadge key="s" tone="warning" icon={IconWarning} label="ON in the secrets file" />
            ) : (
              <StatusBadge key="s" tone="neutral" icon={IconLock} label="Off" />
            ),
          ],
          ["Trading engine", "Not built yet (Phase 8). Nothing can trade."],
        ]}
      />
      <div className="table-scroll">
      <table className="table">
        <caption className="table__caption">Instruments in config.yaml</caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Asset class</th>
            <th scope="col">Strategy</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {trading.instruments.map((instrument) => (
            <tr key={instrument.symbol}>
              <td className="mono strong">{instrument.symbol}</td>
              <td>{humanise(instrument.asset_class)}</td>
              <td className="mono">{instrument.strategy}</td>
              <td>
                {instrument.enabled ? (
                  <StatusBadge tone="good" label="Enabled" quiet />
                ) : (
                  <StatusBadge tone="muted" label="Disabled" quiet />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Card>
  );
}

function RiskCard({ limits, busy }: { limits: RiskLimitsSummary; busy: boolean }) {
  const perTrade = (limits.max_position_value * limits.STOP_LOSS_PCT) / 100;
  return (
    <Card
      title="Risk limits"
      busy={busy}
      action={
        <Link className="link-arrow" to="/risk">
          How they fit together <IconArrowRight size={14} />
        </Link>
      }
    >
      <KeyValues
        rows={[
          ["Capital the bot may use", formatUsd(limits.MAX_CAPITAL)],
          ["Largest position", `${formatUsd(limits.max_position_value)} (${formatPct(limits.MAX_POSITION_PCT)} of capital)`],
          ["Stop-loss", `${formatPct(limits.STOP_LOSS_PCT)} below the entry: about ${formatUsd(perTrade)} per position`],
          ["Daily loss limit", `${formatUsd(limits.DAILY_LOSS_LIMIT)}, then no new trades that day`],
          ["Total loss limit", `${formatUsd(limits.TOTAL_LOSS_LIMIT)}, then the kill switch stops everything`],
          ["Trades per day", `at most ${limits.MAX_TRADES_PER_DAY}`],
        ]}
      />
      <p className="card__note">From config.yaml. The risk engine that enforces them arrives in Phase 7.</p>
    </Card>
  );
}

function RecentEvents({ resource }: { resource: Resource<EventPage> }) {
  const items = resource.data?.items ?? [];
  return (
    <Card
      title="Recent events"
      busy={resource.refreshing && Boolean(resource.data)}
      action={
        <Link className="link-arrow" to="/events">
          All events <IconArrowRight size={14} />
        </Link>
      }
    >
      {resource.error ? <ErrorNotice error={resource.error} /> : null}
      {resource.data && !items.length ? <p className="empty-line">No events recorded yet.</p> : null}
      {items.length ? (
        <ul className="feed">
          {items.map((event) => (
            <li className="feed__item" key={event.id}>
              <SeverityBadge severity={event.severity} quiet />
              <div className="feed__body">
                <p className="feed__text">{event.message}</p>
                <p className="feed__meta">
                  <span className="mono">{event.event_type}</span> · <Time value={event.occurred_at} relative />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {resource.loading ? <p className="loading">Loading…</p> : null}
    </Card>
  );
}

function RecentAudit({ resource }: { resource: Resource<AuditPage> }) {
  const items = resource.data?.items ?? [];
  return (
    <Card
      title="Recent audit entries"
      busy={resource.refreshing && Boolean(resource.data)}
      action={
        <Link className="link-arrow" to="/audit">
          Full audit log <IconArrowRight size={14} />
        </Link>
      }
    >
      {resource.error ? <ErrorNotice error={resource.error} /> : null}
      {resource.data && !items.length ? <p className="empty-line">The audit log is empty.</p> : null}
      {items.length ? (
        <ul className="feed">
          {items.map((entry) => (
            <li className="feed__item" key={entry.id}>
              <span className="feed__actor mono">{entry.actor}</span>
              <div className="feed__body">
                <p className="feed__text">
                  <span className="mono strong">{entry.action}</span>
                  {entry.target_id ? (
                    <>
                      {" "}
                      <span className="muted">→</span> {entry.target_type ? `${entry.target_type} ` : ""}
                      <span className="mono">{entry.target_id}</span>
                    </>
                  ) : null}
                </p>
                <p className="feed__meta">
                  <Time value={entry.occurred_at} relative />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {resource.loading ? <p className="loading">Loading…</p> : null}
    </Card>
  );
}
