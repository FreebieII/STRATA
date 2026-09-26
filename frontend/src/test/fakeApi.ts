// A stand-in for the STRATA API in unit tests: fetch() is replaced by a small
// router, and every request is recorded so tests can check what was sent.

import { vi } from "vitest";

import type { AuditEntry, Identity, SystemEvent, SystemStatus } from "../api/types";

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

/** Routes for a logged-in operator with a healthy system and empty lists. */
export function healthyRoutes(): Record<string, Handler> {
  return {
    "GET /auth/me": () => json(200, identity()),
    "GET /system/status": () => json(200, status()),
    "GET /system/events": () => json(200, { items: [], next_before_id: null }),
    "GET /audit": () => json(200, { items: [], next_before_id: null }),
    "POST /auth/logout": () => noContent(),
  };
}
