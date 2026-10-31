import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoBlocked, demoResetHours } from "@/lib/demo/mode";
import { resetDemo } from "@/lib/demo/reset";

afterEach(() => {
  delete process.env.DEMO_MODE;
  delete process.env.DEMO_RESET_HOURS;
});

describe("demo mode rules", () => {
  it("allows everything when demo mode is off", () => {
    expect(demoBlocked("PUT", "/api/admin/settings/stripe", "application/json")).toBeNull();
  });

  it("refuses what reaches outside the server or changes the platform", () => {
    process.env.DEMO_MODE = "true";
    const blocked = [
      ["PUT", "/api/admin/settings/smtp"],
      ["POST", "/api/admin/plans"],
      ["PATCH", "/api/admin/workspaces/abc"],
      ["POST", "/api/auth/register"],
      ["POST", "/api/auth/forgot-password"],
      ["POST", "/api/team/invitations"],
      ["DELETE", "/api/team/members/abc"],
      ["POST", "/api/whatsapp/accounts"],
      ["POST", "/api/whatsapp/accounts/abc/logout"],
      ["POST", "/api/campaigns/abc/test"],
      ["PUT", "/api/ai/settings"],
      ["POST", "/api/developers"],
      ["POST", "/api/developers/webhooks"],
      ["POST", "/api/billing/checkout"],
      ["POST", "/api/campaigns/media"],
    ];
    for (const [method, path] of blocked) expect(demoBlocked(method!, path!, "application/json"), `${method} ${path}`).toBeTruthy();
    // File attachments anywhere, except CSV contact imports
    expect(demoBlocked("POST", "/api/inbox/conversations/abc/messages", "multipart/form-data; boundary=x")).toBeTruthy();
    expect(demoBlocked("POST", "/api/contacts/imports", "multipart/form-data; boundary=x")).toBeNull();
  });

  it("lets visitors try the CRM", () => {
    process.env.DEMO_MODE = "true";
    const allowed = [
      ["POST", "/api/auth/login"],
      ["POST", "/api/admin/workspaces/abc/impersonate"],
      ["GET", "/api/admin/settings/smtp"],
      ["POST", "/api/contacts"],
      ["POST", "/api/deals/abc/move"],
      ["POST", "/api/inbox/conversations/abc/messages"],
      ["PATCH", "/api/flows/abc"],
      ["POST", "/api/campaigns"],
      ["POST", "/api/ai/knowledge"],
    ];
    for (const [method, path] of allowed) expect(demoBlocked(method!, path!, "application/json"), `${method} ${path}`).toBeNull();
  });

  it("resets every 1 to 24 hours", () => {
    expect(demoResetHours()).toBe(3);
    process.env.DEMO_RESET_HOURS = "100";
    expect(demoResetHours()).toBe(24);
    process.env.DEMO_RESET_HOURS = "0";
    expect(demoResetHours()).toBe(3);
  });
});

describe("demo reset", () => {
  afterAll(async () => {
    await db.organization.deleteMany({});
    await db.user.deleteMany({});
    await db.$disconnect();
  });

  it("replaces every workspace and account with the demo data", async () => {
    const stray = await db.user.create({ data: { email: `visitor-${Date.now()}@test.local`, name: "Visitor", passwordHash: "x" } });
    const strayOrg = await db.organization.create({ data: { name: "Visitor shop", slug: `visitor-${Date.now()}`, memberships: { create: { userId: stray.id, role: "OWNER" } } } });

    const { orgId } = await resetDemo();
    expect(await db.user.findUnique({ where: { id: stray.id } })).toBeNull();
    expect(await db.organization.findUnique({ where: { id: strayOrg.id } })).toBeNull();

    const users = await db.user.findMany({ where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) } } });
    expect(users).toHaveLength(3);
    for (const u of users) expect(verifyPassword(DEMO_PASSWORD, u.passwordHash)).toBe(true);
    expect(users.find((u) => u.email === "admin@demo.test")?.platformRole).toBe("SUPER_ADMIN");
    const roles = await db.membership.findMany({ where: { orgId }, include: { user: { select: { email: true } } } });
    const roleOf = (email: string) => roles.find((m) => m.user.email === email)?.role;
    expect([roleOf("owner@demo.test"), roleOf("agent@demo.test"), roleOf("admin@demo.test")]).toEqual(["OWNER", "AGENT", "ADMIN"]);
    expect(await db.contact.count({ where: { orgId } })).toBe(40);

    // Twice in a row gives the same result
    const again = await resetDemo();
    expect(await db.organization.count()).toBe(1);
    expect(await db.contact.count({ where: { orgId: again.orgId } })).toBe(40);
  });
});
