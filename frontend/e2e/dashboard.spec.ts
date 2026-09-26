// The dashboard through nginx, over HTTPS, with the real API behind it.

import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.STRATA_E2E_URL ?? "https://localhost:8443";
const USERNAME = process.env.STRATA_E2E_USERNAME ?? "";
const PASSWORD = process.env.STRATA_E2E_PASSWORD ?? "";
const CA_FILE = process.env.STRATA_E2E_CA ?? new URL("../../certs/strata-local-ca.crt", import.meta.url).pathname;
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;

test.beforeAll(() => {
  if (!USERNAME || !PASSWORD) {
    throw new Error("Set STRATA_E2E_USERNAME and STRATA_E2E_PASSWORD to an operator's login.");
  }
});

/** Console errors and Content-Security-Policy violations seen on a page. */
function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Asking "who am I?" before logging in is answered 401, which Chromium
    // logs. That one is expected; anything else is a problem.
    if (/status of 401/.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return problems;
}

async function logIn(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Operator login" })).toBeVisible();
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** A link in the main menu (pages also link to each other). */
function menu(page: Page, name: string | RegExp) {
  return page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });
}

function fetchWithCa(path: string): Promise<{ status: number; headers: Record<string, unknown> }> {
  const url = new URL(path, BASE);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { ca: readFileSync(CA_FILE), method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the certificate checks out against the local CA, and the headers are strict", async () => {
  const response = await fetchWithCa("/");
  expect(response.status).toBe(200);
  const csp = String(response.headers["content-security-policy"]);
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe");
  expect(response.headers["x-frame-options"]).toBe("DENY");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
});

test("every protected view needs a login", async ({ page, request }) => {
  const problems = watchForProblems(page);
  for (const path of ["/", "/system", "/events", "/audit", "/risk", "/positions"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Operator login" })).toBeVisible();
  }
  for (const path of ["/api/system/status", "/api/system/events", "/api/audit", "/api/auth/me"]) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
  expect((await request.get("/api/docs")).status()).toBe(404);
  expect(problems).toEqual([]);
});

test("logs in, shows live data on every page, and logs out", async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto("/");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}login.png` });
  await logIn(page);

  await test.step("overview", async () => {
    await expect(page.getByText("Everything is working")).toBeVisible();
    await expect(page.getByRole("region", { name: "Trading mode" })).toContainText("PAPER");
    await expect(page.getByRole("region", { name: "Database" })).toContainText("Healthy");
    await expect(page.getByRole("region", { name: "Redis" })).toContainText("Healthy");
    await expect(page.getByText("SPY", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}overview.png`, fullPage: true });
  });

  await test.step("system", async () => {
    await menu(page, "System").click();
    await expect(page.getByRole("heading", { name: "How live trading is locked" })).toBeVisible();
    await expect(page.getByText(USERNAME, { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}system.png`, fullPage: true });
  });

  await test.step("events", async () => {
    await menu(page, "Events").click();
    await expect(page.getByRole("cell", { name: "api_started" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Info" }).click();
    await expect(page).toHaveURL(/severity=info/);
    await page.getByRole("button", { name: /^Show details of event/ }).first().click();
    await expect(page.getByText("Request ID").first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}events.png`, fullPage: true });
  });

  await test.step("audit log shows this login", async () => {
    await menu(page, "Audit log").click();
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toContainText("login");
    await expect(firstRow).toContainText(USERNAME);
    await page.screenshot({ path: `${SHOTS}audit.png`, fullPage: true });
  });

  await test.step("risk limits", async () => {
    await menu(page, "Risk limits").click();
    await expect(page.getByText("$300", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "5 stop-outs" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}risk.png`, fullPage: true });
  });

  await test.step("a planned page", async () => {
    await menu(page, /Backtests/).click();
    await expect(page.getByRole("heading", { name: "Nothing to show yet" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}backtests.png`, fullPage: true });
  });

  await test.step("dark theme", async () => {
    await menu(page, "Overview").click();
    await page.getByRole("button", { name: /Theme: device/ }).click();
    await page.getByRole("button", { name: /Theme: light/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText("Everything is working")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}overview-dark.png`, fullPage: true });
    await menu(page, "Risk limits").click();
    await expect(page.getByText("$300", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}risk-dark.png`, fullPage: true });
    await page.getByRole("button", { name: /Theme: dark/ }).click();
  });

  await test.step("log out", async () => {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByText("You have logged out.")).toBeVisible();
    // The session really is over: the API refuses the old cookie.
    expect((await page.request.get("/api/system/status")).status()).toBe(401);
    await page.goto("/events");
    await expect(page.getByRole("heading", { name: "Operator login" })).toBeVisible();
  });

  expect(problems).toEqual([]);
});

test("works on a phone-sized screen", async ({ page }) => {
  const problems = watchForProblems(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await logIn(page);
  await expect(page.getByText("Everything is working")).toBeVisible();
  // No sideways scrolling of the page itself.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}phone-overview.png`, fullPage: true });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.screenshot({ path: `${SHOTS}phone-menu.png` });
  await menu(page, "Events").click();
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}phone-events.png`, fullPage: true });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You have logged out.")).toBeVisible();
  expect(problems).toEqual([]);
});
