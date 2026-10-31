import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { campaignStats } from "@/lib/campaigns/view";
import { launchProblems } from "@/lib/campaigns/validate";
import { saveMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { dayKey } from "@/lib/whatsapp/anti-ban";
import { recordIncoming, recordStatus } from "@/lib/whatsapp/ingest";
import { campaignScheduler, dispatchCampaign, startCampaign } from "@/server/jobs/campaigns";
import { processOutbound } from "@/server/jobs/send-message";
import type { QrManager } from "@/server/qr/manager";

// Jobs the code under test enqueues are captured instead of going to pg-boss
const enqueued: { queue: string; data: Record<string, string>; options?: Record<string, unknown> }[] = [];
const graphCalls: { path: string; body: unknown }[] = [];
let server: http.Server;
let wamid = 0;
let orgId: string, userId: string, qrId: string, officialId: string;

const sentByQr: { to: string; text?: string; caption?: string; gapMs: number }[] = [];
const qr = {
  isConnected: () => true,
  send: async (_id: string, to: string, content: { text?: string; caption?: string }, gapMs: number) => {
    sentByQr.push({ to, text: content.text, caption: content.caption, gapMs });
    return `QR-${sentByQr.length}-${Date.now()}`;
  },
} as unknown as QrManager;

// How far into `enqueued` the fake send worker has got
let sendCursor = 0;
async function sendQueued() {
  for (; sendCursor < enqueued.length; sendCursor++) {
    const job = enqueued[sendCursor]!;
    if (job.queue === "message.send") await processOutbound(job.data as never, 0, qr);
  }
}

/** Runs the worker loop by hand: dispatch, then send whatever got queued, until the campaign settles */
async function run(campaignId: string, maxTicks = 50) {
  for (let i = 0; i < maxTicks; i++) {
    await sendQueued();
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (c.status !== "RUNNING") return c;
    await dispatchCampaign({ campaignId });
  }
  return db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      graphCalls.push({ path: req.url!, body: raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url!.endsWith("/media")) return res.end(JSON.stringify({ id: "HEADER-MEDIA-1" }));
      res.end(JSON.stringify({ messages: [{ id: `wamid.C${++wamid}.${Date.now()}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.WHATSAPP_GRAPH_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.__wacrmBoss = Promise.resolve({
    send: async (queue: string, data: Record<string, string>, options?: Record<string, unknown>) => {
      enqueued.push({ queue, data, options });
      return "job";
    },
  } as never);

  const stamp = Date.now();
  userId = (await db.user.create({ data: { email: `camp-${stamp}@test.local`, name: "Marketer", passwordHash: "x" } })).id;
  orgId = (await db.organization.create({ data: { name: "Camp Org", slug: `camp-${stamp}` } })).id;
  await db.membership.create({ data: { orgId, userId, role: "OWNER" } });
  qrId = (await db.whatsAppAccount.create({ data: { orgId, name: "Sales QR", channel: "QR", status: "CONNECTED", minDelaySec: 10, maxDelaySec: 20, warmupEnabled: false, dailyLimit: 1000, connectedAt: new Date() } })).id;
  officialId = (
    await db.whatsAppAccount.create({
      data: { orgId, name: "Cloud", channel: "OFFICIAL", status: "CONNECTED", phoneNumberId: `pn-camp-${stamp}`, wabaId: "waba", accessTokenEnc: encrypt("tok"), appSecretEnc: encrypt("sec") },
    })
  ).id;
  const tdb = orgDb(orgId);
  await tdb.customField.create({ data: { orgId, key: "city", label: "City", type: "TEXT" } });
  await tdb.contact.createMany({
    data: [
      { orgId, phone: "919000000001", name: "Ravi Mehra", fields: { city: "Delhi" }, optedInAt: new Date() },
      { orgId, phone: "919000000002", name: "Asha", fields: { city: "Pune" } },
      { orgId, phone: "919000000003", name: null, fields: {} },
      { orgId, phone: "919000000004", name: "Stopped", optedOut: true, optedOutAt: new Date() },
    ],
  });
});

beforeEach(() => {
  enqueued.length = 0;
  sendCursor = 0;
  sentByQr.length = 0;
  graphCalls.length = 0;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
  server.close();
});

describe("QR campaign", () => {
  let campaignId: string;

  it("is not ready without content", async () => {
    const c = await orgDb(orgId).campaign.create({ data: { orgId, name: "Diwali", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, createdById: userId } });
    campaignId = c.id;
    expect((await launchProblems(orgDb(orgId), c)).problems).toEqual(["Write the message or attach a file."]);
    const ready = await db.campaign.update({ where: { id: c.id }, data: { body: "{Hi|Hello} {{first_name|there}}, Diwali sale in {{city|your city}}!" } });
    expect(await launchProblems(orgDb(orgId), ready)).toEqual({ problems: [], audience: 3 });
  });

  it("freezes the audience (opted-out excluded) and sends one at a time with anti-ban gaps", async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { status: "SCHEDULED" } });
    await startCampaign({ campaignId });
    const started = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect([started.status, started.total]).toEqual(["RUNNING", 3]);
    expect(enqueued.at(-1)).toMatchObject({ queue: "campaign.dispatch", data: { campaignId }, options: { singletonKey: campaignId } });

    // First tick queues exactly one message (QR keeps one in flight)
    await dispatchCampaign({ campaignId });
    expect(enqueued.filter((j) => j.queue === "message.send")).toHaveLength(1);
    expect(await db.campaignRecipient.count({ where: { campaignId, status: "QUEUED" } })).toBe(1);

    const done = await run(campaignId);
    expect(done.status).toBe("COMPLETED");
    expect(sentByQr.map((s) => s.to).sort()).toEqual(["919000000001", "919000000002", "919000000003"]);
    const texts = sentByQr.map((s) => s.text!.replace(/^(Hi|Hello) /, "")).sort();
    expect(texts).toEqual(["Asha, Diwali sale in Pune!", "Ravi, Diwali sale in Delhi!", "there, Diwali sale in your city!"]);
    // Bulk profile: at least the number's minimum delay between messages
    expect(sentByQr.every((s) => s.gapMs >= 10_000)).toBe(true);
    // Broadcast chats start closed (a reply re-opens them)
    expect((await db.conversation.findMany({ where: { accountId: qrId } })).map((c) => c.status)).toEqual(["CLOSED", "CLOSED", "CLOSED"]);
  });

  it("tracks delivery, read and replies", async () => {
    const recipients = await db.campaignRecipient.findMany({ where: { campaignId }, include: { message: true, contact: true }, orderBy: { id: "asc" } });
    const [a, b] = recipients;
    await recordStatus(qrId, a!.message!.externalId!, "DELIVERED");
    await recordStatus(qrId, a!.message!.externalId!, "READ");
    await recordStatus(qrId, b!.message!.externalId!, "DELIVERED");
    await recordStatus(qrId, a!.message!.externalId!, "DELIVERED"); // late receipt doesn't go backwards
    await recordIncoming({ accountId: qrId, orgId, from: a!.contact.phone, externalId: `in-${Date.now()}`, timestamp: new Date(), type: "TEXT", body: "Interested!" });

    expect((await campaignStats([campaignId])).get(campaignId)).toEqual({ total: 3, pending: 0, queued: 0, sent: 3, delivered: 2, read: 1, failed: 0, skipped: 0, replied: 1 });
    const conv = await db.conversation.findFirstOrThrow({ where: { accountId: qrId, contactId: a!.contactId } });
    expect(conv.status).toBe("OPEN");
  });

  it("waits at the daily limit instead of failing the rest", async () => {
    const c = await db.campaign.create({ data: { orgId, name: "Limit", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, body: "Hi", status: "SCHEDULED" } });
    await db.whatsAppAccount.update({ where: { id: qrId }, data: { sentToday: 1000, sentTodayDate: dayKey() } });
    await startCampaign({ campaignId: c.id });
    await dispatchCampaign({ campaignId: c.id });
    const waiting = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect([waiting.status, waiting.statusMessage]).toEqual(["RUNNING", "Daily limit of 1000 messages reached for this number; sending continues tomorrow."]);
    expect(await db.campaignRecipient.count({ where: { campaignId: c.id, status: "PENDING" } })).toBe(3);
    expect(enqueued.at(-1)).toMatchObject({ queue: "campaign.dispatch", options: { startAfter: 900 } });
    await db.whatsAppAccount.update({ where: { id: qrId }, data: { sentToday: 0 } });
    await db.campaign.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  });

  it("only messages opted-in contacts when asked to", async () => {
    const c = await db.campaign.create({ data: { orgId, name: "Consent", accountId: qrId, audience: { type: "all", tagIds: [], consent: "opted_in" }, body: "Hi", status: "SCHEDULED" } });
    await startCampaign({ campaignId: c.id });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).total).toBe(1);
  });

  it("skips contacts who opt out after launch", async () => {
    const c = await db.campaign.create({ data: { orgId, name: "Late opt-out", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, body: "Hi", status: "SCHEDULED" } });
    await startCampaign({ campaignId: c.id });
    await db.contact.updateMany({ where: { orgId, phone: "919000000002" }, data: { optedOut: true } });
    await run(c.id);
    const r = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: c.id, contact: { phone: "919000000002" } } });
    expect([r.status, r.error]).toEqual(["SKIPPED", "The contact opted out."]);
    await db.contact.updateMany({ where: { orgId, phone: "919000000002" }, data: { optedOut: false } });
  });
});

describe("Official template campaign", () => {
  it("uploads the header once and sends the template with each contact's values", async () => {
    const template = await db.template.create({
      data: {
        orgId,
        accountId: officialId,
        externalId: "tpl-promo",
        name: "city_promo",
        language: "en",
        category: "MARKETING",
        status: "APPROVED",
        components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hi {{1}}, new store in {{2}}!" }],
      },
    });
    const media = await saveMedia(orgId, Buffer.from("fake-jpeg"), "image/jpeg", "banner.jpg");
    const c = await db.campaign.create({
      data: {
        orgId,
        name: "Store launch",
        accountId: officialId,
        audience: { type: "all", tagIds: [], consent: "any" },
        templateId: template.id,
        templateParams: { header: [], body: [{ source: "first_name", value: "there" }, { source: "field:city", value: "" }], buttons: {} },
        media: { storageKey: media.storageKey, mimeType: "image/jpeg", fileName: "banner.jpg" },
        status: "SCHEDULED",
      },
    });
    await startCampaign({ campaignId: c.id });
    const done = await run(c.id);
    expect(done.status).toBe("COMPLETED");
    expect(graphCalls.filter((g) => g.path.endsWith("/media"))).toHaveLength(1);
    const sends = graphCalls.filter((g) => g.path.endsWith("/messages")).map((g) => g.body as { to: string; template: { components: unknown[] } });
    expect(sends.map((s) => s.to).sort()).toEqual(["919000000001", "919000000002"]);
    const ravi = sends.find((s) => s.to === "919000000001")!;
    expect(ravi.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "HEADER-MEDIA-1" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ravi" }, { type: "text", text: "Delhi" }] },
    ]);
    // The contact without a city has no value for {{2}} and no fallback: skipped, not sent empty
    const skipped = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: c.id, contact: { phone: "919000000003" } } });
    expect([skipped.status, skipped.error]).toEqual(["SKIPPED", "No value for {{2}}."]);
  });

  it("marks Meta failures and can retry them", async () => {
    const c = await db.campaign.findFirstOrThrow({ where: { orgId, name: "Store launch" } });
    const r = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: c.id, status: "SENT" }, include: { message: true } });
    await recordStatus(officialId, r.message!.externalId!, "FAILED", "(#131026) Message undeliverable");
    expect((await db.campaignRecipient.findUniqueOrThrow({ where: { id: r.id } })).error).toBe("(#131026) Message undeliverable");

    await db.campaignRecipient.updateMany({ where: { campaignId: c.id, status: "FAILED" }, data: { status: "PENDING", error: null, messageId: null } });
    await db.campaign.update({ where: { id: c.id }, data: { status: "RUNNING" } });
    await run(c.id);
    expect((await campaignStats([c.id])).get(c.id)).toMatchObject({ sent: 2, failed: 0, skipped: 1 });
  });
});

describe("scheduler", () => {
  it("starts due campaigns and restarts stalled ones", async () => {
    const due = await db.campaign.create({ data: { orgId, name: "Due", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, body: "Hi", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000) } });
    const later = await db.campaign.create({ data: { orgId, name: "Later", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, body: "Hi", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3_600_000) } });
    const stalled = await db.campaign.create({ data: { orgId, name: "Stalled", accountId: qrId, audience: { type: "all", tagIds: [], consent: "any" }, body: "Hi", status: "RUNNING", lastDispatchAt: new Date(Date.now() - 600_000) } });
    await campaignScheduler();
    const ids = (q: string) => enqueued.filter((j) => j.queue === q).map((j) => j.data.campaignId);
    expect(ids("campaign.start")).toContain(due.id);
    expect(ids("campaign.start")).not.toContain(later.id);
    expect(ids("campaign.dispatch")).toContain(stalled.id);
    // A start job that fires early (rescheduled) does nothing
    await startCampaign({ campaignId: later.id });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: later.id } })).status).toBe("SCHEDULED");
  });
});
