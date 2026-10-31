import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { parseGraph } from "@/lib/flows/graph";
import { flowView } from "@/lib/flows/schema";
import { orgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";
import { isWindowOpen } from "@/lib/whatsapp/window";
import { enqueue, QUEUES } from "@/server/queue";

const startBody = z.object({
  // Either an existing chat, or a phone number + the number to message from
  conversationId: z.string().min(1).optional(),
  phone: z.string().trim().max(30).optional(),
  accountId: z.string().min(1).optional(),
  variables: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(1000)).default({}),
});

/**
 * POST /api/flows/:id/validate   { graph }    check a graph without saving (errors name the step)
 * POST /api/flows/:id/start      start the flow in a chat now (testing, or by an agent)
 * POST /api/flows/:id/duplicate  copy as a new, inactive flow
 */
export const POST = route<RouteContext<"/api/flows/[id]/[action]">>(async (req, ctx) => {
  const { id, action } = await ctx.params;
  const session = await requireApiOrg(action === "start" ? "AGENT" : "ADMIN");
  const tdb = orgDb(session.org.id);
  const flow = await tdb.flow.findUnique({ where: { id } });
  if (!flow) throw new ApiError(404, "Flow not found.");
  const body = await req.json().catch(() => ({}));

  if (action === "validate") {
    parseGraph((body as { graph?: unknown }).graph);
    return NextResponse.json({ ok: true });
  }

  if (action === "start") {
    const input = startBody.parse(body);
    parseGraph(flow.graph);
    let conversationId = input.conversationId;
    if (conversationId) {
      if (!(await tdb.conversation.findUnique({ where: { id: conversationId }, select: { id: true } }))) throw new ApiError(404, "Conversation not found.");
    } else {
      const phone = normalizePhone(input.phone);
      if (!isValidPhone(phone)) throw new ApiError(400, "Enter the phone number with country code.");
      const account = input.accountId ? await tdb.whatsAppAccount.findUnique({ where: { id: input.accountId } }) : await tdb.whatsAppAccount.findFirst({ where: { status: "CONNECTED" }, orderBy: { createdAt: "asc" } });
      if (!account) throw new ApiError(400, "Choose a connected WhatsApp number.");
      const contact = await tdb.contact.upsert({ where: { orgId_phone: { orgId: session.org.id, phone } }, create: { orgId: session.org.id, phone, source: "manual" }, update: {} });
      const conv = await tdb.conversation.upsert({
        where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
        create: { orgId: session.org.id, accountId: account.id, contactId: contact.id },
        update: {},
      });
      conversationId = conv.id;
    }
    const chat = await tdb.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { account: { select: { channel: true } } } });
    if (chat.account.channel === "OFFICIAL" && !isWindowOpen(chat.lastInboundAt)) {
      throw new ApiError(
        409,
        "WhatsApp only lets a business write within 24 hours of the customer's last message. Send any message to this number from that phone first, then start the flow again.",
        "window_closed",
      );
    }
    // Starting a flow on purpose lifts a teammate's pause in that chat
    await tdb.conversation.update({ where: { id: conversationId }, data: { botPausedUntil: null } });
    await enqueue(QUEUES.flowStart, { flowId: flow.id, conversationId, variables: input.variables });
    return NextResponse.json({ ok: true, conversationId });
  }

  if (action === "duplicate") {
    const copy = await tdb.flow.create({
      data: {
        orgId: session.org.id,
        name: `${flow.name} (copy)`.slice(0, 100),
        description: flow.description,
        trigger: flow.trigger,
        keywords: flow.keywords,
        match: flow.match,
        accountIds: flow.accountIds,
        campaignId: flow.campaignId,
        priority: flow.priority,
        timeoutMinutes: flow.timeoutMinutes,
        graph: flow.graph as never,
        createdById: session.user.id,
      },
    });
    await audit({ action: "flow.duplicated", orgId: session.org.id, userId: session.user.id, targetType: "flow", targetId: copy.id, ip: clientIp(req) });
    return NextResponse.json({ flow: flowView(copy) }, { status: 201 });
  }

  throw new ApiError(404, "Unknown action.");
});
