import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { contactDisplayName } from "@/lib/inbox";
import { orgDb } from "@/lib/tenancy";
import type { Prisma } from "@/generated/prisma/client";

const PAGE = 50;

// Report filters; "sent" and "delivered" include the later stages, like the report counters
const FILTERS: Record<string, Prisma.CampaignRecipientWhereInput> = {
  all: {},
  sent: { status: { in: ["SENT", "DELIVERED", "READ"] } },
  delivered: { status: { in: ["DELIVERED", "READ"] } },
  read: { status: "READ" },
  replied: { repliedAt: { not: null } },
  failed: { status: "FAILED" },
  skipped: { status: "SKIPPED" },
  pending: { status: { in: ["PENDING", "QUEUED"] } },
};

/** GET ?status=&cursor= : who got the campaign and what happened */
export const GET = route<RouteContext<"/api/campaigns/[id]/recipients">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  if (!(await tdb.campaign.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Campaign not found.");
  const status = z
    .enum(Object.keys(FILTERS) as [string, ...string[]])
    .default("all")
    .parse(req.nextUrl.searchParams.get("status") ?? undefined);
  const cursor = req.nextUrl.searchParams.get("cursor");
  const rows = await tdb.campaignRecipient.findMany({
    where: { campaignId: id, ...FILTERS[status] },
    include: { contact: { select: { id: true, phone: true, name: true, waName: true } }, message: { select: { conversationId: true } } },
    orderBy: { id: "asc" },
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  return NextResponse.json({
    recipients: page.map((r) => ({
      id: r.id,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
      repliedAt: r.repliedAt,
      contact: { id: r.contact.id, phone: r.contact.phone, name: contactDisplayName(r.contact) },
      conversationId: r.message?.conversationId ?? null,
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null,
  });
});
