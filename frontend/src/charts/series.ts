// Turning the API's statistics into chart columns and legends.

import type { AuditStats, EventStats } from "../api/types";
import { IconCritical, IconDebug, IconGood, IconInfo, IconSerious, IconWarning } from "../components/Icons";
import type { LegendItem } from "./ChartFrame";
import type { Column, ColumnSeries } from "./ColumnChart";

export const PERIODS = [7, 14, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(value: string | null, fallback: Period): Period {
  const days = Number(value);
  return PERIODS.find((p) => p === days) ?? fallback;
}

/** The viewer's time zone, which the API counts days in. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local midnight at the start of a period of `days` days ending today, as ISO 8601. */
export function periodStart(days: number, now: Date = new Date()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.toISOString();
}

// A "YYYY-MM-DD" day is a calendar date, not a moment: format it in UTC so no
// time zone can move it to the day before.
const shortDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function dayLabels(day: string): { label: string; longLabel: string } {
  const date = new Date(`${day}T12:00:00Z`);
  return { label: shortDay.format(date), longLabel: longDay.format(date) };
}

// Severities, bottom to top: the ones that matter sit on the baseline, where
// they are easiest to compare. Info and debug are quiet grays.
export const SEVERITY_SERIES: ColumnSeries[] = [
  { key: "critical", label: "Critical", color: "var(--critical)" },
  { key: "error", label: "Error", color: "var(--serious)" },
  { key: "warning", label: "Warning", color: "var(--warning)" },
  { key: "info", label: "Info", color: "var(--quiet-1)" },
  { key: "debug", label: "Debug", color: "var(--quiet-2)" },
];

export const SEVERITY_LEGEND: LegendItem[] = [
  { key: "critical", label: "Critical", color: "var(--critical)", icon: IconCritical },
  { key: "error", label: "Error", color: "var(--serious)", icon: IconSerious },
  { key: "warning", label: "Warning", color: "var(--warning)", icon: IconWarning },
  { key: "info", label: "Info", color: "var(--quiet-1)", icon: IconInfo },
  { key: "debug", label: "Debug", color: "var(--quiet-2)", icon: IconDebug },
];

export function eventColumns(stats: EventStats): Column[] {
  return stats.buckets.map((bucket) => ({
    key: bucket.day,
    ...dayLabels(bucket.day),
    values: {
      critical: bucket.critical,
      error: bucket.error,
      warning: bucket.warning,
      info: bucket.info,
      debug: bucket.debug,
    },
  }));
}

// Audit actions in three groups (the first three validated chart colours).
export const AUDIT_SERIES: ColumnSeries[] = [
  { key: "login", label: "Logins", color: "var(--series-1)" },
  { key: "logout", label: "Logouts", color: "var(--series-2)" },
  { key: "other", label: "Account and database changes", color: "var(--series-3)" },
];

export const AUDIT_LEGEND: LegendItem[] = AUDIT_SERIES.map((s) => ({ ...s, shape: "rect" as const }));

export function auditColumns(stats: AuditStats): Column[] {
  return stats.buckets.map((bucket) => {
    const login = bucket.counts.login ?? 0;
    const logout = bucket.counts.logout ?? 0;
    return {
      key: bucket.day,
      ...dayLabels(bucket.day),
      values: { login, logout, other: bucket.total - login - logout },
    };
  });
}

// Sign-ins mean good or bad, so they wear the status colours.
export const SIGN_IN_SERIES: ColumnSeries[] = [
  { key: "failed", label: "Failed", color: "var(--critical)" },
  { key: "ok", label: "Successful", color: "var(--good)" },
];

export const SIGN_IN_LEGEND: LegendItem[] = [
  { key: "ok", label: "Successful", color: "var(--good)", icon: IconGood },
  { key: "failed", label: "Failed", color: "var(--critical)", icon: IconCritical },
];

/** Successful logins (audit log) and failed ones (events), day by day. */
export function signInColumns(logins: AuditStats, failures: EventStats): Column[] {
  const failed = new Map(failures.buckets.map((b) => [b.day, b.warning + b.error + b.critical + b.info + b.debug]));
  return logins.buckets.map((bucket) => ({
    key: bucket.day,
    ...dayLabels(bucket.day),
    values: { ok: bucket.counts.login ?? 0, failed: failed.get(bucket.day) ?? 0 },
  }));
}
