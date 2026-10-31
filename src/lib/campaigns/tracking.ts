import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import type { MessageStatus, RecipientStatus } from "@/generated/prisma/client";

const RANK: Record<RecipientStatus, number> = { PENDING: 0, QUEUED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: -1, SKIPPED: -1 };

/** How long after a campaign message a customer message counts as a reply to it */
export const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Mirrors a campaign message's delivery status onto its recipient row (sent → delivered →
 * read; failures win until the message is delivered). Cheap no-op for non-campaign messages.
 */
export async function trackMessageStatus(messageId: string, status: MessageStatus, error?: string | null) {
  if (status !== "SENT" && status !== "DELIVERED" && status !== "READ" && status !== "FAILED") return;
  const r = await db.campaignRecipient.findUnique({ where: { messageId }, select: { id: true, status: true, sentAt: true, campaignId: true, orgId: true } });
  if (!r) return;
  if (status === "FAILED") {
    if (r.status === "DELIVERED" || r.status === "READ" || r.status === "FAILED") return;
  } else if (RANK[status] <= RANK[r.status]) return;

  await db.campaignRecipient.update({
    where: { id: r.id },
    data: { status, ...(status === "FAILED" ? { error: error ?? "Sending failed." } : { error: null, sentAt: r.sentAt ?? new Date() }) },
  });
  await publish(`org:${r.orgId}`, "campaign.updated", { campaignId: r.campaignId });
}

/** A customer message after a campaign message (same number, within the window) counts as a reply */
export async function trackReply(accountId: string, contactId: string, at: Date) {
  const since = new Date(at.getTime() - REPLY_WINDOW_MS);
  const rows = await db.$queryRaw<{ campaignId: string; orgId: string }[]>`
    UPDATE "CampaignRecipient" r SET "repliedAt" = ${at}
    FROM "Campaign" c
    WHERE c.id = r."campaignId" AND c."accountId" = ${accountId} AND r."contactId" = ${contactId}
      AND r."repliedAt" IS NULL AND r."sentAt" IS NOT NULL AND r."sentAt" >= ${since} AND r."sentAt" <= ${at}
    RETURNING r."campaignId", r."orgId"`;
  for (const row of rows) await publish(`org:${row.orgId}`, "campaign.updated", { campaignId: row.campaignId });
}
