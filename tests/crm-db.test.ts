import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { contactWhere, fieldDefs } from "@/lib/crm/contacts";
import { moveDeal } from "@/lib/crm/deals";
import { ensureDefaultPipeline } from "@/lib/crm/pipelines";
import { compileSegment, type SegmentFilter } from "@/lib/crm/segments";
import { saveMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { processContactImport } from "@/server/jobs/contact-import";
import { processTaskReminders } from "@/server/jobs/task-reminders";

let orgId: string, otherOrgId: string, userId: string, accountId: string;

beforeAll(async () => {
  const stamp = Date.now();
  userId = (await db.user.create({ data: { email: `crm-${stamp}@test.local`, name: "Owner", passwordHash: "x" } })).id;
  orgId = (await db.organization.create({ data: { name: "CRM Org", slug: `crm-${stamp}`, currency: "INR" } })).id;
  otherOrgId = (await db.organization.create({ data: { name: "Other", slug: `crm-other-${stamp}` } })).id;
  await db.membership.create({ data: { orgId, userId, role: "OWNER" } });
  accountId = (await db.whatsAppAccount.create({ data: { orgId, name: "QR", channel: "QR", status: "CONNECTED" } })).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("segments on real data", () => {
  const phones = (rows: { phone: string }[]) => rows.map((r) => r.phone).sort();

  it("filters by fields, tags, consent and activity", async () => {
    const tdb = orgDb(orgId);
    await tdb.customField.createMany({
      data: [
        { orgId, key: "city", label: "City", type: "TEXT" },
        { orgId, key: "spend", label: "Spend", type: "NUMBER" },
        { orgId, key: "renewal", label: "Renewal", type: "DATE" },
      ],
    });
    const vip = await tdb.tag.create({ data: { orgId, name: "VIP" } });
    const mk = (phone: string, data: object = {}) => tdb.contact.create({ data: { orgId, phone, ...data } });
    const a = await mk("911000000001", { fields: { city: "Delhi", spend: 900, renewal: "2026-12-01" }, optedInAt: new Date() });
    await mk("911000000002", { fields: { city: "Mumbai", spend: 50 }, optedOut: true });
    const c = await mk("911000000003", { fields: { city: "" } });
    await mk("911000000004", { createdAt: new Date("2025-01-01") });
    await db.contactTag.create({ data: { contactId: a.id, tagId: vip.id } });
    await db.contactTag.create({ data: { contactId: c.id, tagId: vip.id } });
    await tdb.conversation.create({ data: { orgId, accountId, contactId: c.id, lastInboundAt: new Date() } });

    const defs = await fieldDefs(tdb);
    const run = async (filter: SegmentFilter) => phones(await tdb.contact.findMany({ where: compileSegment(filter, defs), select: { phone: true } }));

    expect(await run({ match: "all", conditions: [{ type: "field", key: "spend", op: "gt", value: 100 }] })).toEqual(["911000000001"]);
    expect(await run({ match: "all", conditions: [{ type: "field", key: "city", op: "neq", value: "Delhi" }] })).toEqual(["911000000002", "911000000003", "911000000004"]);
    expect(await run({ match: "all", conditions: [{ type: "field", key: "city", op: "empty" }] })).toEqual(["911000000003", "911000000004"]);
    expect(await run({ match: "all", conditions: [{ type: "field", key: "renewal", op: "gt", value: "2026-11-30" }] })).toEqual(["911000000001"]);
    expect(await run({ match: "all", conditions: [{ type: "tag", op: "has", tagId: vip.id }, { type: "opted_in", value: false }] })).toEqual(["911000000003"]);
    expect(await run({ match: "any", conditions: [{ type: "opted_out", value: true }, { type: "created", op: "older_than_days", days: 30 }] })).toEqual([
      "911000000002",
      "911000000004",
    ]);
    expect(await run({ match: "all", conditions: [{ type: "last_message", op: "within_days", days: 7 }] })).toEqual(["911000000003"]);
    expect((await run({ match: "all", conditions: [{ type: "last_message", op: "never" }] })).length).toBe(3);
    expect(await run({ match: "all", conditions: [{ type: "attr", attr: "phone", op: "starts_with", value: "+91 100000000" }] })).toEqual([
      "911000000001",
      "911000000002",
      "911000000003",
      "911000000004",
    ]);

    // Saved segment used through the list filters
    const seg = await tdb.segment.create({ data: { orgId, name: "Big spenders", filter: { match: "all", conditions: [{ type: "field", key: "spend", op: "gt", value: 100 }] } } });
    expect(phones(await tdb.contact.findMany({ where: await contactWhere(tdb, { segmentId: seg.id }), select: { phone: true } }))).toEqual(["911000000001"]);
    expect(phones(await tdb.contact.findMany({ where: await contactWhere(tdb, { consent: "opted_out" }), select: { phone: true } }))).toEqual(["911000000002"]);
  });

  it("can't use another workspace's segment", async () => {
    const foreign = await db.segment.create({ data: { orgId: otherOrgId, name: "x", filter: { match: "all", conditions: [] } } });
    await expect(contactWhere(orgDb(orgId), { segmentId: foreign.id })).rejects.toThrow(/not found/);
  });
});

describe("CSV import job", () => {
  async function runImport(csv: string, mapping: string[], options: object) {
    const { storageKey } = await saveMedia(orgId, Buffer.from(csv), "text/csv", "test.csv");
    const imp = await db.contactImport.create({
      data: { orgId, createdById: userId, fileName: "test.csv", storageKey, mapping, options, status: "PENDING" },
    });
    await processContactImport({ importId: imp.id });
    return db.contactImport.findUniqueOrThrow({ where: { id: imp.id } });
  }

  it("creates, updates, tags and reports bad rows", async () => {
    await orgDb(orgId).customField.create({ data: { orgId, key: "plan", label: "Plan", type: "SELECT", options: ["Gold", "Silver"] } });
    const csv = [
      "Name,Mobile,Email,Plan,Labels",
      "Ravi,90000 12345,ravi@example.com,gold,Wholesale; Delhi",
      "Asha,+44 7700 900123,,Silver,",
      "Dup,9000012345,,,",
      "Bad phone,12,,,",
      "Bad plan,9811100001,,Platinum,",
      "Bad email,9811100002,not-an-email,,",
      "Delhi customer,911000000001,,,", // existing contact from the segment test
    ].join("\n");
    const result = await runImport(csv, ["name", "phone", "email", "field:plan", "tags"], { defaultCountryCode: "91", updateExisting: true, tags: ["Expo 2026"], markOptedIn: true });

    expect(result.status).toBe("COMPLETED");
    expect([result.totalRows, result.created, result.updated, result.skipped, result.failed]).toEqual([7, 2, 1, 1, 3]);
    expect((result.errors as { row: number }[]).map((e) => e.row)).toEqual([5, 6, 7]);

    const ravi = await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId, phone: "919000012345" } }, include: { tags: { include: { tag: true } } } });
    expect([ravi.name, ravi.email, ravi.fields, ravi.source, !!ravi.optedInAt]).toEqual(["Ravi", "ravi@example.com", { plan: "Gold" }, "import", true]);
    expect(ravi.tags.map((t) => t.tag.name).sort()).toEqual(["Delhi", "Expo 2026", "Wholesale"]);
    expect((await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId, phone: "447700900123" } } })).fields).toEqual({ plan: "Silver" });

    // Existing contact: name updated, other custom fields kept, opted-in recorded
    const existing = await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId, phone: "911000000001" } } });
    expect([existing.name, (existing.fields as Record<string, unknown>).city]).toEqual(["Delhi customer", "Delhi"]);
    expect(await db.activity.count({ where: { orgId, type: "contact.created", contactId: ravi.id } })).toBe(1);
  });

  it("is idempotent and can leave existing contacts untouched", async () => {
    const csv = "phone,name\n919000012345,Changed name\n919999900000,New person\n";
    const result = await runImport(csv, ["phone", "name"], { updateExisting: false });
    expect([result.created, result.updated, result.skipped]).toEqual([1, 0, 1]);
    expect((await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId, phone: "919000012345" } } })).name).toBe("Ravi");
  });

  it("never touches other workspaces", async () => {
    await db.contact.create({ data: { orgId: otherOrgId, phone: "915550000001", name: "Theirs" } });
    await runImport("phone,name\n915550000001,Mine now\n", ["phone", "name"], { updateExisting: true });
    expect((await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId: otherOrgId, phone: "915550000001" } } })).name).toBe("Theirs");
    expect((await db.contact.findUniqueOrThrow({ where: { orgId_phone: { orgId, phone: "915550000001" } } })).name).toBe("Mine now");
  });
});

describe("pipelines and deals", () => {
  it("creates the default pipeline once", async () => {
    const tdb = orgDb(orgId);
    await Promise.all([ensureDefaultPipeline(tdb, orgId), ensureDefaultPipeline(tdb, orgId)]);
    const pipelines = await tdb.pipeline.findMany({ include: { stages: { orderBy: { position: "asc" } } } });
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]!.stages.map((s) => s.kind)).toEqual(["OPEN", "OPEN", "OPEN", "OPEN", "WON", "LOST"]);
  });

  it("orders, moves and closes deals", async () => {
    const tdb = orgDb(orgId);
    const pipeline = await tdb.pipeline.findFirstOrThrow({ include: { stages: { orderBy: { position: "asc" } } } });
    const [lead, qualified, , , won] = pipeline.stages;
    const contact = await tdb.contact.findFirstOrThrow({ where: { phone: "919000012345" } });
    const mk = (title: string, position: number) =>
      tdb.deal.create({ data: { orgId, title, value: 1000, currency: "INR", pipelineId: pipeline.id, stageId: lead!.id, contactId: contact.id, position } });
    const d1 = await mk("A", 1024);
    const d2 = await mk("B", 2048);
    const d3 = await mk("C", 3072);

    // Drop C between A and B
    await moveDeal(tdb, d3, { stageId: lead!.id, beforeId: d1.id, afterId: d2.id }, userId);
    const order = async (stageId: string) => (await tdb.deal.findMany({ where: { stageId }, orderBy: { position: "asc" } })).map((d) => d.title);
    expect(await order(lead!.id)).toEqual(["A", "C", "B"]);

    // Into Won: closed, timeline entries on the deal and its contact
    await moveDeal(tdb, (await tdb.deal.findUniqueOrThrow({ where: { id: d1.id } }))!, { stageId: won!.id }, userId);
    const closed = await tdb.deal.findUniqueOrThrow({ where: { id: d1.id } });
    expect([closed.status, !!closed.closedAt]).toEqual(["WON", true]);
    expect((await tdb.activity.findMany({ where: { dealId: d1.id }, orderBy: { createdAt: "asc" } })).map((a) => a.type)).toEqual(["deal.stage_changed", "deal.won"]);
    expect(await tdb.activity.count({ where: { contactId: contact.id, type: "deal.won" } })).toBe(1);

    // Back to an open stage reopens it
    await moveDeal(tdb, closed, { stageId: qualified!.id }, userId);
    const reopened = await tdb.deal.findUniqueOrThrow({ where: { id: d1.id } });
    expect([reopened.status, reopened.closedAt]).toEqual(["OPEN", null]);
  });

  it("respaces a column when positions get too close", async () => {
    const tdb = orgDb(orgId);
    const pipeline = await tdb.pipeline.findFirstOrThrow({ include: { stages: { orderBy: { position: "asc" } } } });
    const stage = pipeline.stages[2]!;
    const mk = (title: string, position: number) => tdb.deal.create({ data: { orgId, title, currency: "INR", pipelineId: pipeline.id, stageId: stage.id, position } });
    const x = await mk("X", 1);
    const y = await mk("Y", 1 + 1e-9);
    const z = await mk("Z", 5000);
    await moveDeal(tdb, z, { stageId: stage.id, beforeId: x.id, afterId: y.id }, userId);
    expect((await tdb.deal.findMany({ where: { stageId: stage.id }, orderBy: { position: "asc" } })).map((d) => d.title)).toEqual(["X", "Z", "Y"]);
  });

  it("refuses a stage from another workspace", async () => {
    const tdb = orgDb(orgId);
    const theirs = orgDb(otherOrgId);
    await ensureDefaultPipeline(theirs, otherOrgId);
    const foreignStage = await theirs.stage.findFirstOrThrow();
    const deal = await tdb.deal.findFirstOrThrow();
    await expect(moveDeal(tdb, deal, { stageId: foreignStage.id }, userId)).rejects.toThrow(/Stage not found/);
  });
});

describe("task reminders", () => {
  it("reminds once per due task", async () => {
    const tdb = orgDb(orgId);
    const past = new Date(Date.now() - 60_000);
    const due = await tdb.task.create({ data: { orgId, title: "Call Ravi", dueAt: past, assigneeId: userId } });
    const later = await tdb.task.create({ data: { orgId, title: "Later", dueAt: new Date(Date.now() + 3_600_000), assigneeId: userId } });
    const done = await tdb.task.create({ data: { orgId, title: "Done", dueAt: past, assigneeId: userId, completedAt: new Date() } });

    expect(await processTaskReminders()).toBeGreaterThanOrEqual(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: due.id } })).reminderSentAt).not.toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: later.id } })).reminderSentAt).toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).reminderSentAt).toBeNull();
    // Second run: nothing left to remind
    const again = await db.task.count({ where: { id: due.id, reminderSentAt: null } });
    expect(again).toBe(0);
  });
});

describe("CRM tenant isolation", () => {
  it("scopes every CRM table", async () => {
    const theirs = orgDb(otherOrgId);
    expect(await theirs.customField.count()).toBe(0);
    expect(await theirs.segment.count()).toBe(1); // only their own
    expect(await theirs.deal.count()).toBe(0);
    expect(await theirs.task.count()).toBe(0);
    expect(await theirs.activity.count()).toBe(0);
    expect(await theirs.contactImport.count()).toBe(0);
    const myDeal = await orgDb(orgId).deal.findFirstOrThrow();
    expect(await theirs.deal.findUnique({ where: { id: myDeal.id } })).toBeNull();
    expect((await theirs.deal.updateMany({ where: { id: myDeal.id }, data: { title: "hijack" } })).count).toBe(0);
  });
});
