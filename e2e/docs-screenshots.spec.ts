import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { APP_URL, E2E } from "./support/env";

/**
 * Retakes the screenshots in documentation/images (and a few extra ones for the README)
 * from the Demo Store data. Only runs on request:
 *   DOCS_SCREENSHOTS=1 npx playwright test e2e/docs-screenshots.spec.ts
 * The installer screenshots (install-*.jpg) need an app that isn't installed yet; they aren't retaken here.
 */
test.skip(!process.env.DOCS_SCREENSHOTS, "Set DOCS_SCREENSHOTS=1 to retake the documentation screenshots");

const images = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "documentation", "images");

async function demoIds() {
  const db = new Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  const one = async (sql: string) => ((await db.query(sql)).rows[0] as { id: string } | undefined)?.id;
  const org = await one(`SELECT id FROM "Organization" WHERE name = 'Demo Store' LIMIT 1`);
  const ids = {
    conversation: await one(`SELECT c.id FROM "Conversation" c WHERE c."orgId" = '${org}' ORDER BY (SELECT count(*) FROM "Message" m WHERE m."conversationId" = c.id) DESC, c."lastMessageAt" DESC LIMIT 1`),
    campaign: await one(`SELECT id FROM "Campaign" WHERE "orgId" = '${org}' AND status = 'COMPLETED' LIMIT 1`),
    flow: await one(`SELECT id FROM "Flow" WHERE "orgId" = '${org}' LIMIT 1`),
  };
  await db.end();
  return ids;
}

async function shot(page: Page, url: string, name: string, prepare?: () => Promise<void>) {
  await page.goto(url, { waitUntil: "networkidle" });
  await prepare?.();
  // Let transitions and the flow canvas settle
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(images, `${name}.jpg`), type: "jpeg", quality: 82 });
}

test("documentation screenshots", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const res = await page.request.post("/api/auth/login", { data: { email: E2E.admin.email, password: E2E.admin.password }, headers: { origin: APP_URL } });
  expect(res.ok()).toBeTruthy();
  const ids = await demoIds();

  await page.setViewportSize({ width: 1280, height: 860 });
  await shot(page, "/app", "app-dashboard");
  await shot(page, `/app/inbox?c=${ids.conversation}`, "app-inbox");
  await shot(page, "/app/contacts", "app-contacts");
  await shot(page, "/app/deals", "app-deals");
  await shot(page, "/app/tasks", "app-tasks");
  await shot(page, `/app/campaigns/${ids.campaign}`, "app-campaign-report");
  await shot(page, `/app/automations/${ids.flow}`, "app-flow-builder");
  await shot(page, "/app/settings/numbers", "app-settings-numbers");
  await shot(page, "/app/settings/numbers", "app-connect-number", async () => {
    await page.getByRole("button", { name: "Add number" }).first().click();
    await page.getByRole("dialog").waitFor();
  });
  await shot(page, "/app/settings/ai", "app-settings-ai");
  await shot(page, "/app/settings/developers", "app-settings-developers");
  await shot(page, "/admin", "admin-overview");
  await shot(page, "/admin/plans", "admin-plans");
  await shot(page, "/admin/settings", "admin-settings");

  await page.setViewportSize({ width: 375, height: 812 });
  await shot(page, "/app", "mobile-dashboard");
  await shot(page, "/app/inbox", "mobile-inbox");
});
