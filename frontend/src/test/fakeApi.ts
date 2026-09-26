// A stand-in for the STRATA API in unit tests: fetch() is replaced by a small
// router, and every request is recorded so tests can check what was sent.

import { vi } from "vitest";

import type {
  AuditEntry,
  AuditStats,
  EventStats,
  HealthHistory,
  Identity,
  SystemEvent,
  SystemStatus,
} from "../api/types";

export type Recorded = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
};

type Handler = (request: Recorded) => Response | Promise<Response>;

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export const unauthorised = () => json(401, { detail: "Log in, or send the API token." });

/** Replace fetch; routes are "METHOD /path" (the part after /api). */
export function fakeApi(routes: Record<string, Handler>) {
  const requests: Recorded[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    if (!url.pathname.startsWith("/api/")) throw new Error(`unexpected request to ${url.pathname}`);
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const recorded: Recorded = {
      method: init.method ?? "GET",
      path: url.pathname.slice("/api".length),
      query: url.searchParams,
      headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})),
      body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      credentials: init.credentials,
    };
    requests.push(recorded);
    const handler = routes[`${recorded.method} ${recorded.path}`];
    if (!handler) return json(404, { detail: `no fake for ${recorded.method} ${recorded.path}` });
    return handler(recorded);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    requests,
    fetchMock,
    last: (method: string, path: string) =>
      [...requests].reverse().find((r) => r.method === method && r.path === path),
    count: (method: string, path: string) =>
      requests.filter((r) => r.method === method && r.path === path).length,
  };
}

// --- sample data -------------------------------------------------------------------

export const identity = (username = "alex"): Identity => ({
  via: "session",
  username,
  session_expires_at: "2026-09-26T04:00:00Z",
});

export function status(overrides: { liveSwitch?: boolean; failing?: string } = {}): SystemStatus {
  const checks = [
    { name: "database", ok: true, detail: "reachable", latency_ms: 1.8 },
    { name: "schema", ok: true, detail: "up to date (migration 0002)", latency_ms: null },
    { name: "redis", ok: true, detail: "reachable", latency_ms: 0.4 },
  ].map((check) =>
    check.name === overrides.failing
      ? { ...check, ok: false, detail: "OperationalError: connection refused", latency_ms: null }
      : check,
  );
  return {
    status: overrides.failing ? "unavailable" : "ok",
    version: "0.1.0",
    git_commit: "c73ab5149bd938825ee3d56b49ab77793e09800c",
    component: "api",
    started_at: "2026-09-25T12:00:00Z",
    uptime_s: 3725,
    trading: {
      live_trading_switch: overrides.liveSwitch ?? false,
      default_mode: "paper",
      timezone: "America/New_York",
      instruments: [
        { symbol: "SPY", asset_class: "stock", strategy: "ma_crossover", enabled: true },
        { symbol: "BTC/USD", asset_class: "crypto", strategy: "ma_crossover", enabled: false },
      ],
      risk_limits: {
        MAX_CAPITAL: 300,
        MAX_POSITION_PCT: 20,
        STOP_LOSS_PCT: 5,
        DAILY_LOSS_LIMIT: 15,
        TOTAL_LOSS_LIMIT: 60,
        MAX_TRADES_PER_DAY: 3,
        max_position_value: 60,
      },
      strategies: {
        ma_crossover: { fast_period: 20, slow_period: 50 },
        rsi_reversion: { rsi_period: 14, buy_below: 30, sell_above: 70 },
      },
      costs: {
        stock: { fee_pct: 0, fee_per_sell_usd: 0.02, slippage_pct: 0.05 },
        crypto: { fee_pct: 0.25, fee_per_sell_usd: 0, slippage_pct: 0.15 },
      },
      backtest: { start_date: "2021-01-01", test_start_date: "2024-07-01", end_date: null },
      stock_data_feed: "sip",
    },
    checks,
  };
}

export function event(id: number, overrides: Partial<SystemEvent> = {}): SystemEvent {
  return {
    id,
    occurred_at: "2026-09-25T12:00:00Z",
    component: "api",
    event_type: "api_started",
    severity: "info",
    message: `event number ${id}`,
    request_id: null,
    details: {},
    ...overrides,
  };
}

export function auditEntry(id: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    occurred_at: "2026-09-25T12:00:00Z",
    actor: "alex",
    action: "login",
    target_type: "operator",
    target_id: "alex",
    request_id: "abc123",
    details: { address: "192.168.1.20" },
    ...overrides,
  };
}

function days(count: number, end = "2026-09-26"): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(last - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

export function eventStats(count = 14, perDay: Partial<Record<string, number>>[] = []): EventStats {
  const buckets = days(count).map((day, i) => ({
    day,
    debug: 0,
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
    ...(perDay[i] ?? {}),
  }));
  const total = buckets.reduce((sum, b) => sum + b.debug + b.info + b.warning + b.error + b.critical, 0);
  return {
    days: count,
    tz: "UTC",
    since: `${days(count)[0]}T00:00:00Z`,
    buckets,
    types: total ? [{ name: "api_started", count: total }] : [],
    total,
  };
}

export function auditStats(count = 30, perDay: Record<string, number>[] = []): AuditStats {
  const buckets = days(count).map((day, i) => {
    const counts = perDay[i] ?? {};
    return { day, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  const totals: Record<string, number> = {};
  for (const bucket of buckets) {
    for (const [name, n] of Object.entries(bucket.counts)) totals[name] = (totals[name] ?? 0) + n;
  }
  return {
    days: count,
    tz: "UTC",
    since: `${days(count)[0]}T00:00:00Z`,
    buckets,
    actions: Object.entries(totals)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    total: Object.values(totals).reduce((a, b) => a + b, 0),
  };
}

export function healthHistory(window: "1h" | "6h" | "24h" = "1h"): HealthHistory {
  const count = window === "1h" ? 60 : 72;
  const bucket = window === "1h" ? 60 : window === "6h" ? 300 : 1200;
  const start = Date.parse("2026-09-26T11:00:00Z");
  const points = (latency: number, failAt: number | null) =>
    Array.from({ length: count }, (_, i) => ({
      start: new Date(start + i * bucket * 1000).toISOString(),
      samples: i < count - 5 ? 0 : 4,
      failed: i === failAt ? 4 : 0,
      latency_avg_ms: i < count - 5 || i === failAt ? null : latency,
      latency_max_ms: i < count - 5 || i === failAt ? null : latency * 2,
    }));
  return {
    window,
    bucket_s: bucket,
    sample_every_s: 15,
    recording_since: "2026-09-26T11:55:00Z",
    series: [
      { name: "database", points: points(1.5, count - 2), availability_pct: 80 },
      { name: "redis", points: points(0.4, null), availability_pct: 100 },
    ],
  };
}

/** Routes for a logged-in operator with a healthy system and empty lists. */
export function healthyRoutes(): Record<string, Handler> {
  return {
    "GET /auth/me": () => json(200, identity()),
    "GET /system/status": () => json(200, status()),
    "GET /system/events": () => json(200, { items: [], next_before_id: null }),
    "GET /audit": () => json(200, { items: [], next_before_id: null }),
    "GET /system/events/stats": (request) =>
      json(200, eventStats(Number(request.query.get("days") ?? 14))),
    "GET /audit/stats": (request) => json(200, auditStats(Number(request.query.get("days") ?? 30))),
    "GET /system/health/history": (request) =>
      json(200, healthHistory((request.query.get("window") as "1h" | "6h" | "24h" | null) ?? "1h")),
    "POST /auth/logout": () => noContent(),
  };
}
