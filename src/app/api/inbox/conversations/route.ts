import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { conversationInclude, conversationView } from "@/lib/inbox";
import { orgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 30;

/**
 * GET /api/inbox/conversations?status=OPEN|PENDING|CLOSED|ALL&assignee=me|unassigned|all
 *     &accountId=...&q=search&cursor=<conversationId>
 */
export const GET = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const p = req.nextUrl.searchParams;
  const status = p.get("status") ?? "OPEN";
  const assignee = p.get("assignee") ?? "all";
  const q = p.get("q")?.trim().slice(0, 100);

  const where: Prisma.ConversationWhereInput = {};
  if (status !== "ALL") where.status = z.enum(["OPEN", "PENDING", "CLOSED"]).parse(status);
  if (assignee === "me") where.assigneeId = session.user.id;
  else if (assignee === "unassigned") where.assigneeId = null;
  if (p.get("accountId")) where.accountId = p.get("accountId")!;
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.contact = {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { waName: { contains: q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    };
  }

  const cursor = p.get("cursor");
  const rows = await orgDb(session.org.id).conversation.findMany({
    where,
    include: conversationInclude,
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  return NextResponse.json({ conversations: page.map(conversationView), nextCursor: hasMore ? page[page.length - 1].id : null });
});

const startBody = z.object({
  accountId: z.string().min(1),
  phone: z.string().trim().min(5).max(30),
  name: z.string().trim().max(100).optional(),
});

/** Starts (or reopens) a conversation with a phone number from a chosen WhatsApp number */
export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const input = await parseBody(req, startBody);
  const tdb = orgDb(session.org.id);

  const account = await tdb.whatsAppAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new ApiError(404, "WhatsApp number not found.");
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) throw new ApiError(400, "Enter the phone number with country code, e.g. +91 90000 12345.");

  const contact = await tdb.contact.upsert({
    where: { orgId_phone: { orgId: session.org.id, phone } },
    create: { orgId: session.org.id, phone, name: input.name || null },
    update: input.name ? { name: input.name } : {},
  });
  const conversation = await tdb.conversation.upsert({
    where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
    create: { orgId: session.org.id, accountId: account.id, contactId: contact.id, assigneeId: session.user.id },
    update: { status: "OPEN" },
    include: conversationInclude,
  });
  return NextResponse.json({ conversation: conversationView(conversation) }, { status: 201 });
});
