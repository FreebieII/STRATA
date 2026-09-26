// The dashboard as a whole, against a fake API: logging in and out, the
// trading-mode banner, and each page.

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { DASHBOARD_HEADER } from "./api/client";
import {
  auditEntry,
  event,
  fakeApi,
  healthyRoutes,
  identity,
  json,
  status,
  unauthorised,
} from "./test/fakeApi";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;

describe("logging in", () => {
  it("asks for a login first, then shows the page that was asked for", async () => {
    const user = userEvent.setup();
    const server = fakeApi({
      ...healthyRoutes(),
      "GET /auth/me": () => unauthorised(),
      "POST /auth/login": () => json(200, identity()),
    });
    open("/events?severity=warning");
    expect(await screen.findByRole("heading", { name: "Operator login" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Username"), "alex");
    await user.type(screen.getByLabelText("Password"), "a long pass phrase");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Events" })).toBeInTheDocument();
    expect(where()).toBe("/events?severity=warning");
    const sent = server.last("POST", "/auth/login");
    expect(sent?.body).toEqual({ username: "alex", password: "a long pass phrase" });
    expect(sent?.headers[DASHBOARD_HEADER]).toBe("1");
  });

  it("shows a wrong password as the API explains it, and clears the field", async () => {
    const user = userEvent.setup();
    fakeApi({
      "GET /auth/me": () => unauthorised(),
      "POST /auth/login": () => json(401, { detail: "Wrong username or password." }),
    });
    open("/");
    await user.type(await screen.findByLabelText("Username"), "alex");
    await user.type(screen.getByLabelText("Password"), "not it at all");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Username")).toHaveValue("alex");
  });

  it("passes on how long to wait after too many failures", async () => {
    const user = userEvent.setup();
    fakeApi({
      "GET /auth/me": () => unauthorised(),
      "POST /auth/login": () =>
        json(429, { detail: "Too many failed logins. Try again in 15 minute(s)." }, { "Retry-After": "899" }),
    });
    open("/");
    await user.type(await screen.findByLabelText("Username"), "alex");
    await user.type(screen.getByLabelText("Password"), "whatever it is");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 15 minute(s).");
  });

  it("warns when the page isn't on HTTPS, where the browser would drop the login", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, get: () => false });
    try {
      fakeApi({ "GET /auth/me": () => unauthorised() });
      open("/");
      expect(await screen.findByText("This page isn't using HTTPS")).toBeInTheDocument();
    } finally {
      delete (window as { isSecureContext?: boolean }).isSecureContext;
    }
  });

  it("doesn't warn on HTTPS", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, get: () => true });
    try {
      fakeApi({ "GET /auth/me": () => unauthorised() });
      open("/");
      expect(await screen.findByRole("heading", { name: "Operator login" })).toBeInTheDocument();
      expect(screen.queryByText("This page isn't using HTTPS")).toBeNull();
    } finally {
      delete (window as { isSecureContext?: boolean }).isSecureContext;
    }
  });

  it("never sends the operator to another site after logging in", async () => {
    const { safeReturnPath } = await import("./pages/LoginPage");
    expect(safeReturnPath("/audit?action=login")).toBe("/audit?action=login");
    expect(safeReturnPath("//evil.example/")).toBe("/");
    expect(safeReturnPath("https://evil.example/")).toBe("/");
    expect(safeReturnPath("/login")).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
  });

  it("offers to try again when the API can't be reached", async () => {
    const user = userEvent.setup();
    let reachable = false;
    const routes = healthyRoutes();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!reachable) throw new TypeError("Failed to fetch");
        const path = new URL(String(input), "http://localhost").pathname.slice(4);
        const handler = routes[`${init?.method ?? "GET"} ${path}`];
        return handler ? handler({} as never) : json(404, {});
      }),
    );
    open("/");
    expect(await screen.findByText("The dashboard can't reach STRATA")).toBeInTheDocument();
    reachable = true;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });
});

describe("while logged in", () => {
  it("goes back to the login page when the session ends", async () => {
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => unauthorised() });
    open("/system");
    expect(await screen.findByRole("heading", { name: "Operator login" })).toBeInTheDocument();
    expect(screen.getByText("Your session has ended. Log in again to continue.")).toBeInTheDocument();
  });

  it("logs out through the API", async () => {
    const user = userEvent.setup();
    const server = fakeApi(healthyRoutes());
    open("/");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByText("You have logged out.")).toBeInTheDocument();
    expect(server.last("POST", "/auth/logout")?.headers[DASHBOARD_HEADER]).toBe("1");
  });

  it("stays logged in, and says so, when logging out fails", async () => {
    const user = userEvent.setup();
    fakeApi({ ...healthyRoutes(), "POST /auth/logout": () => json(503, { detail: "The session store (Redis) is unavailable." }) });
    open("/");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByText(/Couldn't log out: The session store \(Redis\) is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });
});

describe("the trading-mode banner", () => {
  it("says PAPER, and that the live switch is off", async () => {
    fakeApi(healthyRoutes());
    open("/");
    const banner = await screen.findByRole("region", { name: "Trading mode" });
    expect(within(banner).getByText("PAPER")).toBeInTheDocument();
    expect(await within(banner).findByText("Live switch off")).toBeInTheDocument();
  });

  it("says loudly when LIVE_TRADING=true is in the secrets file", async () => {
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => json(200, status({ liveSwitch: true })) });
    open("/");
    const banner = await screen.findByRole("region", { name: "Trading mode" });
    expect(await within(banner).findByText("Live switch ON")).toBeInTheDocument();
    expect(banner).toHaveClass("mode-banner--switch-on");
  });
});

describe("the overview", () => {
  it("shows the health checks, the setup and the limits", async () => {
    fakeApi(healthyRoutes());
    open("/");
    expect(await screen.findByText("Everything is working")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Database" })).toHaveTextContent("1.8 ms");
    expect(screen.getByRole("region", { name: "Schema" })).toHaveTextContent("migration 0002");
    expect(screen.getByText("SPY")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("$60 (20% of capital)")).toBeInTheDocument();
  });

  it("names a failing check and what is wrong with it", async () => {
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => json(200, status({ failing: "redis" })) });
    open("/");
    expect(await screen.findByText("Something needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Redis: OperationalError: connection refused/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Redis" })).getByText("Failing")).toBeInTheDocument();
  });

  it("explains an API that can't reach its database", async () => {
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => json(503, { detail: "The database is unavailable." }) });
    open("/");
    expect(await screen.findByText("Couldn't get the system status")).toBeInTheDocument();
    expect(screen.getByText("The database is unavailable.")).toBeInTheDocument();
  });
});

describe("the events page", () => {
  it("filters by severity and pages through older events", async () => {
    const user = userEvent.setup();
    const server = fakeApi({
      ...healthyRoutes(),
      "GET /system/events": (request) =>
        request.query.get("before_id") === "51"
          ? json(200, { items: [event(50, { message: "an older one" })], next_before_id: null })
          : json(200, { items: [event(52), event(51)], next_before_id: 51 }),
    });
    open("/events");
    expect(await screen.findByText("event number 52")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Warning" }));
    await waitFor(() => expect(server.last("GET", "/system/events")?.query.get("severity")).toBe("warning"));
    expect(where()).toBe("/events?severity=warning");

    await user.click(await screen.findByRole("button", { name: /Older/ }));
    expect(await screen.findByText("an older one")).toBeInTheDocument();
    expect(server.last("GET", "/system/events")?.query.get("before_id")).toBe("51");
    expect(server.last("GET", "/system/events")?.query.get("severity")).toBe("warning");

    await user.click(screen.getByRole("button", { name: /Newer/ }));
    expect(await screen.findByText("event number 52")).toBeInTheDocument();
    expect(where()).toBe("/events?severity=warning");
  });

  it("filters by event type once the name is valid", async () => {
    const user = userEvent.setup();
    const server = fakeApi(healthyRoutes());
    open("/events");
    const input = await screen.findByLabelText("Event type");
    await user.type(input, "Bad Name!");
    expect(await screen.findByText("Lowercase letters, digits and . _ - only")).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "login_failed{Enter}");
    await waitFor(() => expect(server.last("GET", "/system/events")?.query.get("event_type")).toBe("login_failed"));
    expect(where()).toBe("/events?type=login_failed");
  });

  it("shows details as text, so nothing in an event can run", async () => {
    const user = userEvent.setup();
    fakeApi({
      ...healthyRoutes(),
      "GET /system/events": () =>
        json(200, {
          items: [
            event(9, {
              severity: "warning",
              message: "<img src=x onerror=alert(1)>",
              details: { username: "<script>alert(2)</script>" },
              request_id: "req-9",
            }),
          ],
          next_before_id: null,
        }),
    });
    const { container } = open("/events");
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show details of event 9" }));
    expect(screen.getByText("req-9")).toBeInTheDocument();
    expect(screen.getByText(/"username": "<script>alert\(2\)<\/script>"/)).toBeInTheDocument();
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("says so when nothing matches", async () => {
    fakeApi(healthyRoutes());
    open("/events?severity=critical");
    expect(await screen.findByText("No events match these filters.")).toBeInTheDocument();
  });
});

describe("the audit log", () => {
  it("lists entries and filters by action", async () => {
    const user = userEvent.setup();
    const server = fakeApi({
      ...healthyRoutes(),
      "GET /audit": () => json(200, { items: [auditEntry(3, { action: "operator_created", actor: "cli:root" })], next_before_id: null }),
    });
    open("/audit");
    expect(await screen.findByText("operator_created")).toBeInTheDocument();
    expect(screen.getByText("cli:root")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Action"), "login{Enter}");
    await waitFor(() => expect(server.last("GET", "/audit")?.query.get("action")).toBe("login"));
  });
});

describe("the risk page", () => {
  it("turns the limits into dollars and losing trades", async () => {
    fakeApi(healthyRoutes());
    open("/risk");
    expect(await screen.findByText("$300")).toBeInTheDocument();
    const stop = screen.getByRole("meter", { name: "Loss when one position hits its stop" });
    expect(stop).toHaveAttribute("aria-valuenow", "1");
    expect(stop).toHaveAttribute("aria-valuetext", expect.stringContaining("$3"));
    expect(screen.getByRole("img", { name: "5 stop-outs" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "20 stop-outs" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 trades" })).toBeInTheDocument();
    expect(screen.getByText(/Not enforced yet/)).toBeInTheDocument();
  });

  it("does the arithmetic from the API's numbers", async () => {
    const { riskFigures } = await import("./pages/RiskPage");
    const limits = status().trading.risk_limits;
    expect(riskFigures(limits)).toEqual({
      capital: 300,
      position: 60,
      lossPerStop: 3,
      stopsPerDay: 5,
      stopsInTotal: 20,
    });
    expect(riskFigures({ ...limits, STOP_LOSS_PCT: 0 }).stopsPerDay).toBe(0);
  });
});

describe("pages that come later", () => {
  it("say what they will show and when, instead of showing made-up data", async () => {
    fakeApi(healthyRoutes());
    open("/positions");
    expect(await screen.findByRole("heading", { name: "Nothing to show yet" })).toBeInTheDocument();
    expect(screen.getByText(/Phase 8 \(paper trading\)/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Positions/ });
    expect(within(link).getByText("Planned")).toBeInTheDocument();
  });

  it("an unknown address says so", async () => {
    fakeApi(healthyRoutes());
    open("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("the theme switch", () => {
  it("goes device -> light -> dark -> device, and is remembered", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    open("/");
    const button = await screen.findByRole("button", { name: /Theme: device/ });
    await user.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("strata.theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: /Theme: light/ }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("button", { name: /Theme: dark/ }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("strata.theme")).toBeNull();
  });
});

describe("polling", () => {
  it("asks for the status again every 15 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const server = fakeApi(healthyRoutes());
      open("/");
      await screen.findByText("Everything is working");
      const before = server.count("GET", "/system/status");
      await act(() => vi.advanceTimersByTimeAsync(15_000));
      await waitFor(() => expect(server.count("GET", "/system/status")).toBe(before + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});
