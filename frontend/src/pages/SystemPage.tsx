// The API process, every health check in full, the session, and how live
// trading is locked.

import { useSystemStatus } from "../api/SystemStatusContext";
import { useAuth } from "../auth/AuthContext";
import { IconGood, IconLock, IconWarning } from "../components/Icons";
import { Card, ErrorNotice, KeyValues, PageHeader, RefreshControl, Time } from "../components/Parts";
import { HealthBadge, StatusBadge } from "../components/StatusBadge";
import { formatDateTime, formatDuration, formatMs, humanise } from "../lib/format";

export function SystemPage() {
  const { status } = useSystemStatus();
  const { state } = useAuth();
  const data = status.data;
  const identity = state.phase === "signed-in" ? state.identity : null;
  const stale = Boolean(status.error && data);

  return (
    <>
      <PageHeader title="System" description="The API process, its health checks and your session.">
        <RefreshControl updatedAt={status.updatedAt} refreshing={status.refreshing} onRefresh={status.refresh} every="15 s" />
      </PageHeader>

      {status.error ? <ErrorNotice error={status.error} title="Couldn't get the system status" /> : null}
      {!data && status.loading ? <p className="loading">Loading…</p> : null}

      {data ? (
        <div className="grid grid--2">
          <Card title="API process" busy={stale}>
            <KeyValues
              rows={[
                [
                  "Overall",
                  data.status === "ok" ? (
                    <StatusBadge key="o" tone="good" label="All checks pass" />
                  ) : (
                    <StatusBadge key="o" tone="critical" label="A check is failing" />
                  ),
                ],
                ["Version", <span key="v" className="mono">{data.version}</span>],
                ["Code version (git)", <span key="g" className="mono">{data.git_commit ?? "not recorded"}</span>],
                ["Component", <span key="c" className="mono">{data.component}</span>],
                ["Started", formatDateTime(data.started_at)],
                ["Running for", formatDuration(data.uptime_s)],
              ]}
            />
          </Card>

          <Card title="Your session">
            {identity ? (
              <KeyValues
                rows={[
                  ["Operator", <span key="u" className="mono strong">{identity.username ?? "—"}</span>],
                  ["Logged in with", identity.via === "session" ? "Dashboard login" : "API token"],
                  [
                    "Session ends",
                    identity.session_expires_at ? <Time key="e" value={identity.session_expires_at} /> : "—",
                  ],
                ]}
              />
            ) : null}
            <p className="card__note">
              A session lasts 8 hours. Logging out ends it straight away, and{" "}
              <span className="mono">strata operator disable</span> ends every session of that operator.
            </p>
          </Card>

          <Card title="Health checks" className="span-2" busy={stale}>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Health checks</caption>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Result</th>
                    <th scope="col">Detail</th>
                    <th scope="col" className="num">
                      Response time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.checks.map((check) => (
                    <tr key={check.name}>
                      <td className="strong">{humanise(check.name)}</td>
                      <td>
                        <HealthBadge ok={check.ok} quiet />
                      </td>
                      <td className="wrap">{check.detail}</td>
                      <td className="num mono">{check.latency_ms !== null ? formatMs(check.latency_ms) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="card__note">
              Anything that trades treats a failing check as “do not trade”.
            </p>
          </Card>

          <Card title="How live trading is locked" className="span-2">
            <p className="card__lede">
              Real money needs all four of these at once. None of them can be changed from this
              dashboard.
            </p>
            <ol className="locks">
              <li className="locks__item">
                <span className="locks__state">
                  {data.trading.live_trading_switch ? (
                    <StatusBadge tone="warning" icon={IconWarning} label="Set" />
                  ) : (
                    <StatusBadge tone="neutral" icon={IconLock} label="Not set" />
                  )}
                </span>
                <span>
                  <span className="mono">LIVE_TRADING=true</span> in the secrets file (
                  <span className="mono">.env</span>) on the STRATA machine.
                </span>
              </li>
              <li className="locks__item">
                <span className="locks__state">
                  <StatusBadge tone="neutral" icon={IconLock} label="At start-up" />
                </span>
                <span>
                  The <span className="mono">--live</span> flag when the trading process is started.
                </span>
              </li>
              <li className="locks__item">
                <span className="locks__state">
                  <StatusBadge tone="neutral" icon={IconLock} label="At start-up" />
                </span>
                <span>Live account keys in the secrets file, separate from the paper keys.</span>
              </li>
              <li className="locks__item">
                <span className="locks__state">
                  <StatusBadge tone="neutral" icon={IconLock} label="At start-up" />
                </span>
                <span>The operator typing a confirmation phrase at the machine’s own terminal.</span>
              </li>
            </ol>
            <p className="card__note">
              <IconGood size={14} /> There is no trading process yet (it arrives in Phase 8), so
              nothing is trading, on paper or for real.
            </p>
          </Card>
        </div>
      ) : null}
    </>
  );
}
