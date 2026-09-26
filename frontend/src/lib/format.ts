// Turning numbers and times into text. Times are shown in the viewer's own
// time zone on a 24-hour clock; the exact UTC time is always available as a
// tooltip.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** $300, $2.50: cents only when there are some. */
export function formatUsd(value: number): string {
  return Number.isInteger(value) ? usdWhole.format(value) : usd.format(value);
}

/** 20%, 2.5% */
export function formatPct(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** 0.42 ms, 1.8 ms, 24 ms */
export function formatMs(value: number): string {
  if (value < 1) return `${value.toFixed(2)} ms`;
  if (value < 10) return `${value.toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

/** 45s, 12m 5s, 3h 4m, 2d 4h */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const timeOnly = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(value: string | number | Date): string {
  return dateTime.format(new Date(value));
}

export function formatTime(value: string | number | Date): string {
  return timeOnly.format(new Date(value));
}

/** The exact moment in UTC, for tooltips: 2026-09-25 14:03:05 UTC */
export function formatUtc(value: string | number | Date): string {
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function formatAgo(value: string | number | Date, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
}

/** "database" -> "Database", "asset_class" -> "Asset class" */
export function humanise(name: string): string {
  const text = name.replace(/[_.-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function shortCommit(commit: string | null): string | null {
  return commit ? commit.slice(0, 7) : null;
}
