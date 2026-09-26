// Successful and failed logins, day by day: the quickest way to notice
// someone guessing passwords.

import { api } from "../api/client";
import { useResource } from "../api/useResource";
import { ErrorNotice } from "../components/Parts";
import { ChartFrame } from "./ChartFrame";
import { ColumnChart, ColumnTable } from "./ColumnChart";
import { browserTimeZone, SIGN_IN_LEGEND, SIGN_IN_SERIES, signInColumns } from "./series";

const DAYS = 14;
const INTERVAL_MS = 60_000;

export function SignInsCard() {
  const tz = browserTimeZone();
  const logins = useResource(
    `sign-ins:ok:${tz}`,
    (signal) => api.auditStats({ days: DAYS, tz, action: "login" }, signal),
    INTERVAL_MS,
  );
  const failures = useResource(
    `sign-ins:failed:${tz}`,
    (signal) => api.eventStats({ days: DAYS, tz, eventType: "login_failed" }, signal),
    INTERVAL_MS,
  );
  const error = logins.error ?? failures.error;
  if (error) return <ErrorNotice error={error} title="Couldn't load the sign-ins" />;
  if (!logins.data || !failures.data) return <p className="loading">Loading the sign-ins…</p>;

  const columns = signInColumns(logins.data, failures.data);
  const failed = failures.data.total;
  return (
    <ChartFrame
      title={`Sign-ins, last ${DAYS} days`}
      subtitle={
        failed
          ? `${logins.data.total} successful, ${failed} failed. Many failures in a day can mean someone is guessing passwords.`
          : `${logins.data.total} successful, none failed.`
      }
      legend={SIGN_IN_LEGEND}
      busy={logins.refreshing || failures.refreshing}
      table={<ColumnTable series={SIGN_IN_SERIES} columns={columns} caption="Sign-ins per day" />}
    >
      <ColumnChart series={SIGN_IN_SERIES} columns={columns} label="Sign-ins per day" noun="sign-ins" height={180} />
    </ChartFrame>
  );
}
