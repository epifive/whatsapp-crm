import type { OrgDb } from "@/lib/tenancy";

export type TimelineItem =
  | { kind: "activity"; id: string; at: Date; type: string; actor: string | null; data: Record<string, unknown> }
  | { kind: "note"; id: string; at: Date; body: string; author: string | null; dealId: string | null }
  | {
      kind: "message";
      id: string;
      at: Date;
      direction: "INBOUND" | "OUTBOUND";
      type: string;
      body: string | null;
      status: string;
      conversationId: string;
      accountName: string;
    };

/**
 * A contact's (or deal's) history, newest first: CRM activity, notes and WhatsApp messages
 * merged into one list. Page backwards with `before` = the last item's `at`.
 */
export async function timeline(
  tdb: OrgDb,
  target: { contactId: string } | { dealId: string },
  opts: { before?: Date; limit?: number } = {},
): Promise<{ items: TimelineItem[]; nextBefore: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const at = opts.before ? { lt: opts.before } : undefined;
  const [activities, notes, messages] = await Promise.all([
    tdb.activity.findMany({ where: { ...target, createdAt: at }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: limit + 1 }),
    tdb.note.findMany({ where: { ...target, createdAt: at }, include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: limit + 1 }),
    "contactId" in target
      ? tdb.message.findMany({
          where: { conversation: { contactId: target.contactId }, createdAt: at },
          select: {
            id: true,
            createdAt: true,
            direction: true,
            type: true,
            body: true,
            status: true,
            conversationId: true,
            account: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit + 1,
        })
      : Promise.resolve([]),
  ]);

  const items: TimelineItem[] = [
    ...activities.map((a) => ({ kind: "activity" as const, id: a.id, at: a.createdAt, type: a.type, actor: a.actor?.name ?? null, data: (a.data ?? {}) as Record<string, unknown> })),
    ...notes.map((n) => ({ kind: "note" as const, id: n.id, at: n.createdAt, body: n.body, author: n.author?.name ?? null, dealId: n.dealId })),
    ...messages.map((m) => ({
      kind: "message" as const,
      id: m.id,
      at: m.createdAt,
      direction: m.direction,
      type: m.type,
      body: m.body ? m.body.slice(0, 500) : null,
      status: m.status,
      conversationId: m.conversationId,
      accountName: m.account.name,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const page = items.slice(0, limit);
  const more = items.length > limit;
  return { items: page, nextBefore: more && page.length ? page[page.length - 1]!.at.toISOString() : null };
}
