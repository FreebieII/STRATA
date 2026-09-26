import { describe, expect, it, vi } from "vitest";

import { fakeApi, json, noContent } from "../test/fakeApi";
import { api, ApiError, apiRequest, DASHBOARD_HEADER, onUnauthorised } from "./client";

describe("apiRequest", () => {
  it("sends the dashboard header and the session cookie, and only to /api", async () => {
    const server = fakeApi({ "GET /system/status": () => json(200, { ok: true }) });
    await apiRequest("/system/status");
    const sent = server.last("GET", "/system/status");
    expect(sent?.headers[DASHBOARD_HEADER]).toBe("1");
    expect(sent?.credentials).toBe("same-origin");
    expect(String(server.fetchMock.mock.calls[0]?.[0])).toBe("/api/system/status");
  });

  it("sends JSON bodies as JSON", async () => {
    const server = fakeApi({ "POST /auth/login": () => json(200, { via: "session" }) });
    await api.login("alex", "correct horse battery");
    const sent = server.last("POST", "/auth/login");
    expect(sent?.headers["Content-Type"]).toBe("application/json");
    expect(sent?.body).toEqual({ username: "alex", password: "correct horse battery" });
  });

  it("treats 204 as success with no content", async () => {
    fakeApi({ "POST /auth/logout": () => noContent() });
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("uses the API's own explanation when there is one", async () => {
    fakeApi({ "GET /system/status": () => json(503, { detail: "The database is unavailable." }) });
    const error = await api.status().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toBe("The database is unavailable.");
  });

  it("explains a proxy error page (not JSON) in words", async () => {
    fakeApi({ "GET /system/status": () => new Response("<html>Bad Gateway</html>", { status: 502 }) });
    const error = (await api.status().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/isn't answering \(HTTP 502\)/);
  });

  it("explains nginx's own rate limit, which has no JSON body", async () => {
    fakeApi({ "POST /auth/login": () => new Response("<html>429</html>", { status: 429 }) });
    const error = (await api.login("alex", "x").catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("Too many attempts from this device. Wait a minute, then try again.");
  });

  it("summarises validation errors", async () => {
    fakeApi({
      "GET /system/events": () => json(422, { detail: [{ msg: "Input should be less than 200" }] }),
    });
    const error = (await api.events({ limit: 500 }).catch((e: unknown) => e)) as ApiError;
    expect(error.message).toBe("The API refused the request: Input should be less than 200.");
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const error = (await api.status().catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/Can't reach the dashboard server/);
  });

  it("lets an aborted request stay an abort", async () => {
    fakeApi({ "GET /system/status": () => json(200, {}) });
    const controller = new AbortController();
    controller.abort();
    await expect(api.status(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads Retry-After", async () => {
    fakeApi({
      "POST /auth/login": () =>
        json(429, { detail: "Too many failed logins. Try again in 3 minute(s)." }, { "Retry-After": "170" }),
    });
    const error = (await api.login("alex", "x").catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(429);
    expect(error.retryAfterS).toBe(170);
  });
});

describe("401 answers", () => {
  it("tell the listeners the session has ended", async () => {
    fakeApi({ "GET /system/status": () => json(401, { detail: "Log in." }) });
    const listener = vi.fn();
    const stop = onUnauthorised(listener);
    await api.status().catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    await api.status().catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("from logging in or 'who am I?' do not", async () => {
    fakeApi({
      "POST /auth/login": () => json(401, { detail: "Wrong username or password." }),
      "GET /auth/me": () => json(401, { detail: "Log in." }),
    });
    const listener = vi.fn();
    const stop = onUnauthorised(listener);
    await api.login("alex", "wrong").catch(() => undefined);
    await api.me().catch(() => undefined);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("list queries", () => {
  it("send only the filters that are set", async () => {
    const server = fakeApi({
      "GET /system/events": () => json(200, { items: [], next_before_id: null }),
      "GET /audit": () => json(200, { items: [], next_before_id: null }),
    });
    await api.events({ limit: 50, beforeId: null, severity: "warning", eventType: null });
    expect(Object.fromEntries(server.last("GET", "/system/events")!.query)).toEqual({
      limit: "50",
      severity: "warning",
    });
    await api.audit({ limit: 10, beforeId: 7, action: "login" });
    expect(Object.fromEntries(server.last("GET", "/audit")!.query)).toEqual({
      limit: "10",
      before_id: "7",
      action: "login",
    });
  });
});
