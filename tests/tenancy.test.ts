import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { orgDb } from "@/lib/tenancy";

// Two tenants; everything done through orgDb(A) must be unable to see or touch tenant B
let orgA: string, orgB: string, userA: string, userB: string;

beforeAll(async () => {
  const stamp = Date.now();
  const [ua, ub] = await Promise.all([
    db.user.create({ data: { email: `a-${stamp}@test.local`, name: "A", passwordHash: "x" } }),
    db.user.create({ data: { email: `b-${stamp}@test.local`, name: "B", passwordHash: "x" } }),
  ]);
  userA = ua.id;
  userB = ub.id;
  orgA = (await db.organization.create({ data: { name: "Org A", slug: `org-a-${stamp}` } })).id;
  orgB = (await db.organization.create({ data: { name: "Org B", slug: `org-b-${stamp}` } })).id;
  await db.membership.create({ data: { orgId: orgA, userId: userA, role: "OWNER" } });
  await db.membership.create({ data: { orgId: orgB, userId: userB, role: "OWNER" } });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await db.$disconnect();
});

describe("orgDb tenant isolation", () => {
  it("lists only its own rows", async () => {
    const a = orgDb(orgA);
    expect((await a.membership.findMany()).map((m) => m.orgId)).toEqual([orgA]);
    expect(await a.membership.count()).toBe(1);
  });

  it("refuses an explicit filter for another org", async () => {
    await expect(orgDb(orgA).membership.findMany({ where: { orgId: orgB } })).rejects.toThrow(/Cross-organization/);
  });

  it("cannot read another org's row by id", async () => {
    const other = await db.membership.findFirstOrThrow({ where: { orgId: orgB } });
    expect(await orgDb(orgA).membership.findUnique({ where: { id: other.id } })).toBeNull();
  });

  it("cannot update or delete another org's rows", async () => {
    const other = await db.membership.findFirstOrThrow({ where: { orgId: orgB } });
    const a = orgDb(orgA);
    await expect(a.membership.update({ where: { id: other.id }, data: { role: "AGENT" } })).rejects.toThrow();
    expect((await a.membership.updateMany({ where: { id: other.id }, data: { role: "AGENT" } })).count).toBe(0);
    expect((await a.membership.deleteMany({ where: { userId: userB } })).count).toBe(0);
    expect((await db.membership.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("OWNER");
  });

  it("stamps its own orgId on created rows, ignoring a spoofed one", async () => {
    const inv = await orgDb(orgA).invitation.create({
      data: { orgId: orgB, email: "x@test.local", tokenHash: `h-${Date.now()}`, invitedById: userA, expiresAt: new Date(Date.now() + 60_000) },
    });
    expect(inv.orgId).toBe(orgA);
  });
});
