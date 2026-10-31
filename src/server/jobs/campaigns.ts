import { canRun } from "@/lib/billing/entitlements";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { audienceWhere } from "@/lib/campaigns/audience";
import { contactVariables, renderQrMessage, renderTemplateMessage, RenderError, type CampaignContent } from "@/lib/campaigns/render";
import { audienceSchema, campaignMediaSchema, templateParamsSchema } from "@/lib/campaigns/schema";
import { campaignStats } from "@/lib/campaigns/view";
import { publish } from "@/lib/realtime";
import { emitEvent } from "@/lib/webhooks";
import { readMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { effectiveDailyLimit, sentTodayFor } from "@/lib/whatsapp/anti-ban";
import { uploadMedia } from "@/lib/whatsapp/official/client";
import { queueOutbound } from "@/lib/whatsapp/outbound";
import type { Campaign, CampaignRecipient, Prisma } from "@/generated/prisma/client";
import { enqueue, QUEUES } from "../queue";

/**
 * Campaign sending. One "dispatch" job per running campaign keeps a small number of its
 * messages in flight and re-schedules itself, so a campaign never floods the send queue:
 * - QR numbers: one message at a time; the anti-ban engine spaces them (typing + jitter) and
 *   customer replies on the same number never wait behind thousands of campaign messages.
 * - Official numbers: up to OFFICIAL_IN_FLIGHT at a time (Meta handles the rate).
 */
const OFFICIAL_IN_FLIGHT = 50;
const QR_IN_FLIGHT = 1;
const TICK_SECONDS = { OFFICIAL: 2, QR: 3 };
const WAIT_SECONDS = { disconnected: 60, dailyLimit: 15 * 60 };
const MATERIALIZE_PAGE = 5000;

export function scheduleDispatch(campaignId: string, startAfterSeconds = 0) {
  return enqueue(QUEUES.campaignDispatch, { campaignId }, { singletonKey: campaignId, ...(startAfterSeconds ? { startAfter: startAfterSeconds } : {}) });
}

async function changed(c: Pick<Campaign, "id" | "orgId">) {
  await publish(`org:${c.orgId}`, "campaign.updated", { campaignId: c.id });
}

async function setStatusMessage(c: Campaign, statusMessage: string | null) {
  if (c.statusMessage === statusMessage) return;
  await db.campaign.update({ where: { id: c.id }, data: { statusMessage } });
  await changed(c);
}

/** Worker handler for QUEUES.campaignStart: freezes the audience into recipient rows, then starts sending */
export async function startCampaign(data: { campaignId: string }) {
  const { count } = await db.campaign.updateMany({
    where: { id: data.campaignId, status: "SCHEDULED", OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    data: { status: "RUNNING", startedAt: new Date(), statusMessage: null },
  });
  if (!count) return; // cancelled, already started, or rescheduled for later
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: data.campaignId } });
  const tdb = orgDb(campaign.orgId);

  let where;
  try {
    where = await audienceWhere(tdb, audienceSchema.parse(campaign.audience));
  } catch (err) {
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "CANCELLED", completedAt: new Date(), statusMessage: (err as Error).message } });
    return changed(campaign);
  }

  // Page by id so the audience is read once, even while contacts change
  let cursor: string | undefined;
  for (;;) {
    const page = await tdb.contact.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: MATERIALIZE_PAGE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!page.length) break;
    await db.campaignRecipient.createMany({ data: page.map((c) => ({ orgId: campaign.orgId, campaignId: campaign.id, contactId: c.id })), skipDuplicates: true });
    cursor = page[page.length - 1]!.id;
    if (page.length < MATERIALIZE_PAGE) break;
  }
  const total = await db.campaignRecipient.count({ where: { campaignId: campaign.id } });
  await db.campaign.update({ where: { id: campaign.id }, data: { total } });
  await changed(campaign);
  await scheduleDispatch(campaign.id);
}

/**
 * Claims up to `n` waiting recipients; SKIP LOCKED keeps two dispatchers from taking the same row.
 * The selection is a MATERIALIZED CTE on purpose: inside `WHERE id IN (SELECT … LIMIT n)` Postgres
 * may re-run the subquery per scanned row and update more than `n` rows.
 */
async function claim(campaignId: string, n: number) {
  return db.$queryRaw<Pick<CampaignRecipient, "id" | "contactId">[]>`
    WITH picked AS MATERIALIZED (
      SELECT id FROM "CampaignRecipient" WHERE "campaignId" = ${campaignId} AND status = 'PENDING'
      ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED
    )
    UPDATE "CampaignRecipient" r SET status = 'QUEUED', "updatedAt" = now()
    FROM picked WHERE r.id = picked.id
    RETURNING r.id, r."contactId"`;
}

async function skip(recipientId: string, error: string) {
  await db.campaignRecipient.update({ where: { id: recipientId }, data: { status: "SKIPPED", error } });
}

type LoadedCampaign = Prisma.CampaignGetPayload<{ include: { account: true; template: true } }>;

/** Builds and queues the message for one recipient */
async function sendTo(c: LoadedCampaign, recipient: Pick<CampaignRecipient, "id" | "contactId">) {
  const contact = await db.contact.findUnique({ where: { id: recipient.contactId } });
  if (!contact) return skip(recipient.id, "The contact was deleted.");
  if (contact.optedOut) return skip(recipient.id, "The contact opted out.");

  let content: CampaignContent;
  try {
    const vars = contactVariables(contact);
    const media = c.media ? campaignMediaSchema.parse(c.media) : null;
    if (c.account.channel === "OFFICIAL") {
      if (!c.template || c.template.status !== "APPROVED") throw new RenderError("The template is no longer approved.");
      content = renderTemplateMessage(c.template, templateParamsSchema.parse(c.templateParams ?? {}), vars, c.mediaProviderId ? { id: c.mediaProviderId, filename: media?.fileName } : null);
    } else {
      content = renderQrMessage(c.body, media, vars);
    }
  } catch (err) {
    if (err instanceof RenderError) return skip(recipient.id, err.message);
    throw err;
  }

  // New chats from a campaign start closed so a broadcast doesn't flood the team inbox;
  // a customer reply re-opens them
  const conversation = await db.conversation.upsert({
    where: { accountId_contactId: { accountId: c.accountId, contactId: contact.id } },
    create: { orgId: c.orgId, accountId: c.accountId, contactId: contact.id, status: "CLOSED" },
    update: {},
  });
  const message = await queueOutbound({
    orgId: c.orgId,
    conversationId: conversation.id,
    accountId: c.accountId,
    type: content.type,
    body: content.body,
    media: content.media,
    payload: { ...(content.payload ?? {}), campaignId: c.id },
    sentById: c.createdById,
    profile: "bulk",
    beforeEnqueue: (m) => db.campaignRecipient.update({ where: { id: recipient.id }, data: { messageId: m.id } }),
  });
  return message;
}

/** Worker handler for QUEUES.campaignDispatch */
export async function dispatchCampaign(data: { campaignId: string }) {
  const c = await db.campaign.findUnique({ where: { id: data.campaignId }, include: { account: true, template: true } });
  if (!c || c.status !== "RUNNING") return;
  await db.campaign.update({ where: { id: c.id }, data: { lastDispatchAt: new Date() } });
  // Waits (and continues by itself) while the workspace's plan isn't active
  if (!(await canRun(c.orgId, "campaigns"))) {
    await setStatusMessage(c, "Waiting: the workspace's plan isn't active or doesn't include campaigns.");
    return scheduleDispatch(c.id, WAIT_SECONDS.dailyLimit);
  }
  const official = c.account.channel === "OFFICIAL";

  if (c.account.status !== "CONNECTED") {
    await setStatusMessage(c, "Waiting for the WhatsApp number to reconnect.");
    return scheduleDispatch(c.id, WAIT_SECONDS.disconnected);
  }
  if (!official) {
    const limit = effectiveDailyLimit(c.account);
    if (sentTodayFor(c.account) >= limit) {
      await setStatusMessage(c, `Daily limit of ${limit} messages reached for this number; sending continues tomorrow.`);
      return scheduleDispatch(c.id, WAIT_SECONDS.dailyLimit);
    }
  }

  // Template media header: upload the file to Meta once for the whole campaign
  if (official && c.media && !c.mediaProviderId) {
    const media = campaignMediaSchema.parse(c.media);
    try {
      c.mediaProviderId = await uploadMedia(c.account.phoneNumberId!, decrypt(c.account.accessTokenEnc!), {
        data: await readMedia(media.storageKey),
        mimeType: media.mimeType,
        fileName: media.fileName,
      });
      await db.campaign.update({ where: { id: c.id }, data: { mediaProviderId: c.mediaProviderId } });
    } catch (err) {
      await setStatusMessage(c, `Could not upload the header file to Meta: ${(err as Error).message}`);
      return scheduleDispatch(c.id, WAIT_SECONDS.disconnected);
    }
  }
  await setStatusMessage(c, null);

  const inFlight = await db.campaignRecipient.count({ where: { campaignId: c.id, status: "QUEUED" } });
  const slots = (official ? OFFICIAL_IN_FLIGHT : QR_IN_FLIGHT) - inFlight;
  if (slots > 0) {
    for (const r of await claim(c.id, slots)) {
      try {
        await sendTo(c, r);
      } catch (err) {
        await skip(r.id, (err as Error).message || "Could not queue the message.");
      }
    }
    await changed(c);
  }

  const remaining = await db.campaignRecipient.count({ where: { campaignId: c.id, status: { in: ["PENDING", "QUEUED"] } } });
  if (!remaining) {
    const { count } = await db.campaign.updateMany({ where: { id: c.id, status: "RUNNING" }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (count) {
      const stats = (await campaignStats([c.id])).get(c.id);
      await emitEvent(c.orgId, "campaign.completed", { campaign: { id: c.id, name: c.name }, stats });
    }
    return changed(c);
  }
  return scheduleDispatch(c.id, TICK_SECONDS[c.account.channel]);
}

/**
 * Worker cron (every minute): starts scheduled campaigns that are due and restarts dispatch for
 * running ones whose job chain was lost (e.g. the worker was restarted mid-campaign).
 */
export async function campaignScheduler(now = new Date()) {
  const due = await db.campaign.findMany({ where: { status: "SCHEDULED", OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }, select: { id: true } });
  for (const c of due) await enqueue(QUEUES.campaignStart, { campaignId: c.id }, { singletonKey: c.id });
  const stale = await db.campaign.findMany({
    where: { status: "RUNNING", OR: [{ lastDispatchAt: null }, { lastDispatchAt: { lt: new Date(now.getTime() - 3 * 60_000) } }] },
    select: { id: true },
  });
  for (const c of stale) await scheduleDispatch(c.id);
}
