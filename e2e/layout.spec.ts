import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { APP_URL, E2E } from "./support/env";

/**
 * Layout scan: every page of the app and the admin panel, with the Demo Store data, at desktop,
 * laptop, tablet and phone widths. A page fails if it errors, logs errors, or has content wider
 * than the screen (scrolling sideways or cut off).
 */
// 360 is the most common Android phone width, 375 the small iPhones
const WIDTHS = [1440, 1280, 1024, 768, 375, 360];

const STATIC_PAGES = [
  "/app",
  "/app/inbox",
  "/app/contacts",
  "/app/contacts/import",
  "/app/contacts/segments",
  "/app/deals",
  "/app/tasks",
  "/app/templates",
  "/app/templates/new",
  "/app/campaigns",
  "/app/automations",
  "/app/settings",
  "/app/settings/organization",
  "/app/settings/team",
  "/app/settings/numbers",
  "/app/settings/tags",
  "/app/settings/fields",
  "/app/settings/pipelines",
  "/app/settings/canned",
  "/app/settings/ai",
  "/app/settings/developers",
  "/app/settings/billing",
  "/admin",
  "/admin/workspaces",
  "/admin/plans",
  "/admin/coupons",
  "/admin/invoices",
  "/admin/settings",
];

/** Detail pages, using records of the Demo Store workspace */
async function detailPages(): Promise<string[]> {
  const db = new Client({ connectionString: E2E.databaseUrl });
  await db.connect();
  const one = async (sql: string) => ((await db.query(sql)).rows[0] as { id: string } | undefined)?.id;
  const org = await one(`SELECT id FROM "Organization" WHERE name = 'Demo Store' LIMIT 1`);
  const where = `WHERE "orgId" = '${org}'`;
  const pages = [
    `/app/contacts/${await one(`SELECT id FROM "Contact" ${where} ORDER BY "createdAt" LIMIT 1`)}`,
    `/app/campaigns/${await one(`SELECT id FROM "Campaign" ${where} LIMIT 1`)}`,
    `/app/automations/${await one(`SELECT id FROM "Flow" ${where} LIMIT 1`)}`,
    `/app/inbox?c=${await one(`SELECT id FROM "Conversation" ${where} ORDER BY "lastMessageAt" DESC NULLS LAST LIMIT 1`)}`,
    `/admin/workspaces/${org}`,
  ];
  await db.end();
  expect(pages.join(" "), "demo records exist").not.toContain("undefined");
  return pages;
}

test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/api/auth/login", {
    data: { email: E2E.admin.email, password: E2E.admin.password },
    headers: { origin: APP_URL },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
});

for (const width of WIDTHS) {
  test(`every page fits at ${width}px`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    const pages = [...STATIC_PAGES, ...(await detailPages())];
    const problems: string[] = [];

    for (const url of pages) {
      const errors: string[] = [];
      const onConsole = (msg: { type(): string; text(): string }) => {
        // The browser logs failed resource loads (e.g. a demo avatar) as errors too; only app errors count
        if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) errors.push(msg.text());
      };
      const onPageError = (err: Error) => errors.push(err.message);
      page.on("console", onConsole);
      page.on("pageerror", onPageError);

      const res = await page.goto(url, { waitUntil: "networkidle" });
      const status = res?.status() ?? 0;
      if (status >= 400) problems.push(`${url}: HTTP ${status}`);
      if (new URL(page.url()).pathname === "/login") problems.push(`${url}: redirected to the login page`);
      if (await page.getByText(/Application error|Something went wrong|This page couldn.t load/i).count()) problems.push(`${url}: error page`);

      const overflow = await page.evaluate(() => {
        const viewport = document.documentElement.clientWidth;
        const describe = (el: HTMLElement) => {
          const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 4).join(".") : "";
          return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${(el.textContent ?? "").trim().slice(0, 40)}" ends at ${Math.round(el.getBoundingClientRect().right)}px`;
        };
        // Sticking out past the right edge is fine inside a sideways-scrolling area (Kanban board,
        // wide tables) or a fixed layer (drawers, dialogs); anywhere else it scrolls or gets cut off
        const allowed = (el: HTMLElement) => {
          // An absolutely positioned element is only clipped by a scrolling ancestor that its
          // containing block (nearest positioned ancestor) is inside of
          let escapes = getComputedStyle(el).position === "absolute";
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const style = getComputedStyle(p);
            if (style.position === "fixed") return true;
            const scrolls = (style.overflowX === "auto" || style.overflowX === "scroll") && p.scrollWidth > p.clientWidth;
            if (scrolls && (!escapes || style.position !== "static")) return true;
            if (style.position !== "static") escapes = style.position === "absolute";
          }
          return false;
        };
        const sticking: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
          const rect = el.getBoundingClientRect();
          if (!rect.width || !rect.height || rect.right <= viewport + 1) continue;
          const style = getComputedStyle(el);
          if (style.visibility === "hidden" || style.position === "fixed" || allowed(el)) continue;
          // Report only the outermost element of each offending block
          const parent = el.parentElement;
          if (parent && parent !== document.body && parent.getBoundingClientRect().right > viewport + 1 && !allowed(parent) && getComputedStyle(parent).position !== "fixed") continue;
          sticking.push(describe(el));
        }
        const scrolls = document.documentElement.scrollWidth > viewport + 1;
        return scrolls || sticking.length ? { scrollWidth: document.documentElement.scrollWidth, viewport, sticking } : null;
      });
      if (overflow) {
        problems.push(`${url}: content wider than the screen (page ${overflow.scrollWidth}px, screen ${overflow.viewport}px): ${overflow.sticking.slice(0, 3).join("; ")}`);
      }
      if (errors.length) problems.push(`${url}: console errors: ${errors.slice(0, 3).join(" | ").slice(0, 400)}`);

      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
}
