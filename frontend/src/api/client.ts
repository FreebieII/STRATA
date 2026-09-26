// Every request the dashboard makes goes through apiRequest(): to /api on the
// same site (nginx, or Vite while developing, forwards it to the STRATA API),
// with the session cookie and the header the API asks dashboards to send.

import type {
  AuditPage,
  AuditStats,
  EventPage,
  EventStats,
  HealthHistory,
  HealthWindow,
  Identity,
  Severity,
  SystemStatus,
} from "./types";

export const API_BASE = "/api";

// The API refuses cookie-authenticated changes without this header. Another
// site can't add it to a request, which is what stops cross-site forgery.
export const DASHBOARD_HEADER = "X-Strata-Dashboard";

// Event types and audit actions look like this (the API checks the same).
export const NAME_PATTERN = /^[a-z0-9_.-]{1,64}$/;

export class ApiError extends Error {
  // The HTTP status, or 0 when the server couldn't be reached at all.
  readonly status: number;
  readonly retryAfterS: number | null;

  constructor(status: number, message: string, retryAfterS: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

type Listener = () => void;
const unauthorisedListeners = new Set<Listener>();

/** Be told whenever the API says "not logged in" (the session ended). */
export function onUnauthorised(listener: Listener): () => void {
  unauthorisedListeners.add(listener);
  return () => {
    unauthorisedListeners.delete(listener);
  };
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  // Logging in and "who am I?" expect 401s; they mustn't end the session.
  expect401?: boolean;
};

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", [DASHBOARD_HEADER]: "1" };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(API_BASE + path, init);
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError(0, "Can't reach the dashboard server. Check the connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const payload = await readJson(response);
  if (!response.ok) {
    if (response.status === 401 && !options.expect401) {
      for (const listener of [...unauthorisedListeners]) listener();
    }
    throw new ApiError(response.status, describeFailure(response.status, payload), retryAfter(response));
  }
  if (payload === undefined) {
    throw new ApiError(response.status, "The API sent an answer the dashboard can't read.");
  }
  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return undefined;
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function describeFailure(status: number, payload: unknown): string {
  const detail = (payload as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined;
    const why = typeof first?.msg === "string" ? `: ${first.msg}` : "";
    return `The API refused the request${why}.`;
  }
  if (status === 429) return "Too many attempts from this device. Wait a minute, then try again.";
  if (status === 502 || status === 503 || status === 504) {
    return `The STRATA API isn't answering (HTTP ${status}). It may be starting up or stopped.`;
  }
  return `The request failed (HTTP ${status}).`;
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// --- the endpoints ---------------------------------------------------------------

export type EventQuery = {
  limit?: number;
  beforeId?: number | null;
  severity?: Severity | null;
  eventType?: string | null;
  // ISO 8601 time: only events at or after it.
  since?: string | null;
};

export type AuditQuery = {
  limit?: number;
  beforeId?: number | null;
  action?: string | null;
  since?: string | null;
};

export type StatsQuery = {
  days: number;
  // An IANA time zone name: days are counted there.
  tz: string;
  eventType?: string | null;
  action?: string | null;
};

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  me: (signal?: AbortSignal) =>
    apiRequest<Identity>("/auth/me", { expect401: true, ...(signal ? { signal } : {}) }),

  login: (username: string, password: string) =>
    apiRequest<Identity>("/auth/login", {
      method: "POST",
      body: { username, password },
      expect401: true,
    }),

  logout: () => apiRequest<undefined>("/auth/logout", { method: "POST", expect401: true }),

  status: (signal?: AbortSignal) =>
    apiRequest<SystemStatus>("/system/status", signal ? { signal } : {}),

  events: (q: EventQuery, signal?: AbortSignal) =>
    apiRequest<EventPage>(
      "/system/events" +
        query({
          limit: q.limit,
          before_id: q.beforeId,
          severity: q.severity,
          event_type: q.eventType,
          since: q.since,
        }),
      signal ? { signal } : {},
    ),

  audit: (q: AuditQuery, signal?: AbortSignal) =>
    apiRequest<AuditPage>(
      "/audit" + query({ limit: q.limit, before_id: q.beforeId, action: q.action, since: q.since }),
      signal ? { signal } : {},
    ),

  eventStats: (q: StatsQuery, signal?: AbortSignal) =>
    apiRequest<EventStats>(
      "/system/events/stats" + query({ days: q.days, tz: q.tz, event_type: q.eventType }),
      signal ? { signal } : {},
    ),

  auditStats: (q: StatsQuery, signal?: AbortSignal) =>
    apiRequest<AuditStats>(
      "/audit/stats" + query({ days: q.days, tz: q.tz, action: q.action }),
      signal ? { signal } : {},
    ),

  healthHistory: (window: HealthWindow, signal?: AbortSignal) =>
    apiRequest<HealthHistory>("/system/health/history" + query({ window }), signal ? { signal } : {}),
};
