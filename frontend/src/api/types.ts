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

export type CostSummary = {
  // Percent of the trade's value, on every buy and every sell.
  fee_pct: number;
  // Dollars, on every sell.
  fee_per_sell_usd: number;
  // Percent worse than the quoted price, on every buy and every sell.
  slippage_pct: number;
};

export type TradingSummary = {
  // True only if the secrets file says LIVE_TRADING=true. Live trading also
  // needs the --live flag and a phrase typed at a terminal.
  live_trading_switch: boolean;
  default_mode: "paper";
  // The trading day's time zone: daily limits reset at midnight here.
  timezone: string;
  instruments: InstrumentSummary[];
  risk_limits: RiskLimitsSummary;
  strategies: {
    ma_crossover: { fast_period: number; slow_period: number };
    rsi_reversion: { rsi_period: number; buy_below: number; sell_above: number };
  };
  costs: { stock: CostSummary; crypto: CostSummary };
  backtest: { start_date: string; test_start_date: string; end_date: string | null };
  stock_data_feed: "sip" | "iex";
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

// --- charts -------------------------------------------------------------------------

export type NameCount = { name: string; count: number };

export type EventDay = {
  day: string;
  debug: number;
  info: number;
  warning: number;
  error: number;
  critical: number;
};

export type EventStats = {
  days: number;
  tz: string;
  since: string;
  buckets: EventDay[];
  types: NameCount[];
  total: number;
};

export type AuditDay = { day: string; counts: Record<string, number>; total: number };

export type AuditStats = {
  days: number;
  tz: string;
  since: string;
  buckets: AuditDay[];
  actions: NameCount[];
  total: number;
};

export type HealthPoint = {
  start: string;
  samples: number;
  failed: number;
  latency_avg_ms: number | null;
  latency_max_ms: number | null;
};

export type HealthSeries = {
  name: string;
  points: HealthPoint[];
  availability_pct: number | null;
};

export type HealthWindow = "1h" | "6h" | "24h";

export type HealthHistory = {
  window: HealthWindow;
  bucket_s: number;
  sample_every_s: number;
  recording_since: string | null;
  series: HealthSeries[];
};
