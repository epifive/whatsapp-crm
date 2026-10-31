import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export type ActivityType =
  | "contact.created"
  | "contact.updated"
  | "contact.opted_in"
  | "contact.opted_out"
  | "contact.owner_changed"
  | "tag.added"
  | "tag.removed"
  | "deal.created"
  | "deal.stage_changed"
  | "deal.won"
  | "deal.lost"
  | "deal.reopened"
  | "task.created"
  | "task.completed";

export interface ActivityInput {
  orgId: string;
  type: ActivityType;
  contactId?: string | null;
  dealId?: string | null;
  actorId?: string | null;
  data?: Prisma.InputJsonValue;
}

/** Adds a timeline entry. Never throws: the timeline must not break the action itself. */
export async function logActivity(entry: ActivityInput | ActivityInput[]): Promise<void> {
  const rows = (Array.isArray(entry) ? entry : [entry]).filter((e) => e.contactId || e.dealId);
  if (!rows.length) return;
  // Entries logged together keep their order on the timeline (1 ms apart)
  const now = Date.now();
  try {
    await db.activity.createMany({
      data: rows.map((e, i) => ({
        orgId: e.orgId,
        type: e.type,
        contactId: e.contactId ?? null,
        dealId: e.dealId ?? null,
        actorId: e.actorId ?? null,
        data: e.data ?? {},
        createdAt: new Date(now + i),
      })),
    });
  } catch (err) {
    console.error("[activity] failed to record", rows[0]?.type, err);
  }
}
