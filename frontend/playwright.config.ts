// Browser tests of the whole running stack (nginx, the API, PostgreSQL and
// Redis), not of a development server. Start the stack first, then:
//
//   STRATA_E2E_USERNAME=alex STRATA_E2E_PASSWORD='...' npm run e2e
//
// Optional: STRATA_E2E_URL (default https://localhost:8443), STRATA_E2E_CA
// (the local CA certificate, default ../certs/strata-local-ca.crt) and
// STRATA_E2E_CHROMIUM (a Chromium to use instead of Playwright's own).
import { defineConfig, devices } from "@playwright/test";

const chromium = process.env.STRATA_E2E_CHROMIUM;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  // One operator logging in and out: run the tests one after another.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.STRATA_E2E_URL ?? "https://localhost:8443",
    // The browser doesn't know the local CA; the certificate is checked
    // against it separately, in dashboard.spec.ts.
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
