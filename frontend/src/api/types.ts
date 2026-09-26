// The shapes of the STRATA API's responses. They mirror strata/api/schemas.py;
// change both together. Times arrive as ISO 8601 strings in UTC.

export type Identity = {
  via: "session" | "token";
  username: string | null;
  session_expires_at: string | null;
};

export type CheckDetail = {
  name: string;
  ok: boolean;
  detail: string;
  latency_ms: number | null;
};

export type InstrumentSummary = {
  symbol: string;
  asset_class: string;
  strategy: string;
  enabled: boolean;
};

export type RiskLimitsSummary = {
  MAX_CAPITAL: number;
  MAX_POSITION_PCT: number;
  STOP_LOSS_PCT: number;
  DAILY_LOSS_LIMIT: number;
  TOTAL_LOSS_LIMIT: number;
  MAX_TRADES_PER_DAY: number;
  max_position_value: number;
};

export type TradingSummary = {
  // True only if the secrets file says LIVE_TRADING=true. Live trading also
  // needs the --live flag and a phrase typed at a terminal.
  live_trading_switch: boolean;
  default_mode: "paper";
  instruments: InstrumentSummary[];
  risk_limits: RiskLimitsSummary;
};

export type SystemStatus = {
  status: "ok" | "unavailable";
  version: string;
  git_commit: string | null;
  component: string;
  started_at: string;
  uptime_s: number;
  trading: TradingSummary;
  checks: CheckDetail[];
};

export const SEVERITIES = ["debug", "info", "warning", "error", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type SystemEvent = {
  id: number;
  occurred_at: string;
  component: string;
  event_type: string;
  // One of SEVERITIES in practice; stored as plain text, so treat others kindly.
  severity: string;
  message: string;
  request_id: string | null;
  details: Record<string, unknown>;
};

export type EventPage = {
  items: SystemEvent[];
  next_before_id: number | null;
};

export type AuditEntry = {
  id: number;
  occurred_at: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  details: Record<string, unknown>;
};

export type AuditPage = {
  items: AuditEntry[];
  next_before_id: number | null;
};
