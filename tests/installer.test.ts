import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { databaseUrl, mergeEnv, testDatabase } from "@/lib/installer";

describe("installer helpers", () => {
  it("builds connection URLs safely", () => {
    expect(databaseUrl({ host: "db.internal", port: 5433, database: "wa crm", user: "app@x", password: "p@ss:w/rd#1", ssl: true })).toBe(
      "postgresql://app%40x:p%40ss%3Aw%2Frd%231@db.internal:5433/wa%20crm?sslmode=require",
    );
    expect(databaseUrl({ url: "postgresql://a:b@h/d" })).toBe("postgresql://a:b@h/d");
  });

  it("updates .env keys and keeps the rest", () => {
    expect(mergeEnv('# mine\nPORT=3000\nAPP_URL="http://old"\n', { APP_URL: "https://crm.example.com", APP_KEY: 'k"ey' })).toBe('# mine\nPORT=3000\nAPP_URL="https://crm.example.com"\nAPP_KEY="k\\"ey"\n');
    expect(mergeEnv(null, { APP_KEY: "x" })).toBe('# Written by the CRM for WhatsApp installer\nAPP_KEY="x"\n');
  });

  it("checks the database", async () => {
    const check = await testDatabase(process.env.DATABASE_URL!);
    expect([check.ourSchema, check.hasTables]).toEqual([true, true]);
    await expect(testDatabase(process.env.DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, "/no_such_database_x$1"))).rejects.toThrow("Couldn't connect to the database");
  });
});

describe("demo data", () => {
  let userId: string;
  let orgId: string | null = null;
  beforeAll(async () => {
    userId = (await db.user.create({ data: { email: `demo-owner-${Date.now()}@test.local`, name: "Demo Owner", passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    if (orgId) {
      const members = await db.membership.findMany({ where: { orgId, userId: { not: userId } }, select: { userId: true } });
      await db.organization.deleteMany({ where: { id: orgId } });
      await db.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
    }
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("creates a complete demo workspace once", async () => {
    orgId = await seedDemo(userId, { currency: "INR" });
    expect(orgId).toBeTruthy();
    const count = async (model: "contact" | "conversation" | "message" | "deal" | "task" | "campaignRecipient" | "flow" | "knowledgeArticle") =>
      (db[model] as unknown as { count: (a: unknown) => Promise<number> }).count({ where: { orgId } });
    expect([await count("contact"), await count("conversation"), await count("deal"), await count("task"), await count("campaignRecipient"), await count("flow"), await count("knowledgeArticle")]).toEqual([40, 8, 10, 5, 28, 1, 3]);
    expect(await count("message")).toBeGreaterThan(10);
    expect(await db.plan.count()).toBeGreaterThanOrEqual(4);
    // Demo tasks never email the made-up teammates
    expect(await db.task.count({ where: { orgId: orgId!, reminderSentAt: null } })).toBe(0);
    expect(await seedDemo(userId)).toBeNull();
  });
});
