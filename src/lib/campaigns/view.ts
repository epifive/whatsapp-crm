import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const campaignInclude = {
  account: { select: { id: true, name: true, channel: true, phone: true, status: true, minDelaySec: true, maxDelaySec: true } },
  template: { select: { id: true, name: true, language: true, status: true, components: true } },
  segment: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.CampaignInclude;

type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

export interface CampaignStats {
  total: number;
  pending: number;
  queued: number;
  sent: number; // reached WhatsApp (sent, delivered or read)
  delivered: number; // delivered or read
  read: number;
  failed: number;
  skipped: number;
  replied: number;
}

/** Live counters for one or many campaigns, from the recipient rows */
export async function campaignStats(campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map<string, CampaignStats>();
  if (!campaignIds.length) return out;
  const [byStatus, replies] = await Promise.all([
    db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaignIds } }, _count: { _all: true } }),
    db.campaignRecipient.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds }, repliedAt: { not: null } }, _count: { _all: true } }),
  ]);
  for (const id of campaignIds) out.set(id, { total: 0, pending: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0 });
  for (const row of byStatus) {
    const s = out.get(row.campaignId)!;
    const n = row._count._all;
    s.total += n;
    if (row.status === "PENDING") s.pending += n;
    if (row.status === "QUEUED") s.queued += n;
    if (row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") s.sent += n;
    if (row.status === "DELIVERED" || row.status === "READ") s.delivered += n;
    if (row.status === "READ") s.read += n;
    if (row.status === "FAILED") s.failed += n;
    if (row.status === "SKIPPED") s.skipped += n;
  }
  for (const row of replies) out.get(row.campaignId)!.replied = row._count._all;
  return out;
}

export function campaignView(c: CampaignRow, stats?: CampaignStats) {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    statusMessage: c.statusMessage,
    account: c.account,
    audience: c.audience,
    segment: c.segment,
    template: c.template ? { id: c.template.id, name: c.template.name, language: c.template.language, status: c.template.status } : null,
    templateParams: c.templateParams,
    body: c.body,
    media: c.media,
    scheduledAt: c.scheduledAt,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdBy: c.createdBy?.name ?? null,
    createdAt: c.createdAt,
    stats: stats ?? null,
  };
}
