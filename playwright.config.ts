import { defineConfig } from "@playwright/test";
import { APP_URL } from "./e2e/support/env";

/**
 * End-to-end tests: `npm run test:e2e`. Global setup wipes a separate *_e2e database, starts a
 * fake Meta Graph API, the app (production build if there is one) and the worker.
 * Locally they use the installed Google Chrome; set E2E_BROWSER_CHANNEL="" to use Playwright's own Chromium.
 */
const channel = process.env.E2E_BROWSER_CHANNEL ?? (process.env.CI ? "" : "chrome");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One app, one database: the specs share state and run in order
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: APP_URL,
    ...(channel ? { channel } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
