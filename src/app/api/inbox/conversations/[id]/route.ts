import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { conversationInclude, conversationView } from "@/lib/inbox";
import { publish } from "@/lib/realtime";
import { automationState } from "@/lib/flows/engine";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/inbox/conversations/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const conversation = await orgDb(session.org.id).conversation.findUnique({ where: { id }, include: conversationInclude });
  if (!conversation) throw new ApiError(404, "Conversation not found.");
  const notes = await orgDb(session.org.id).note.findMany({
    where: { contactId: conversation.contactId },
    include: { author: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    conversation: conversationView(conversation),
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, author: n.author?.name ?? null })),
    automation: await automationState(id),
  });
});

const patchBody = z.object({
  status: z.enum(["OPEN", "PENDING", "CLOSED"]).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(),
});

/** Change status, assignee, or the contact's saved name */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const conversation = await tdb.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError(404, "Conversation not found.");

  if (input.assigneeId) {
    const member = await tdb.membership.findFirst({ where: { userId: input.assigneeId } });
    if (!member) throw new ApiError(400, "That person isn't a member of this workspace.");
  }
  await tdb.conversation.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    },
  });
  if (input.contactName !== undefined) {
    await tdb.contact.update({ where: { id: conversation.contactId }, data: { name: input.contactName || null } });
  }

  if (input.assigneeId !== undefined && input.assigneeId !== conversation.assigneeId) {
    await audit({ action: "inbox.assigned", orgId: session.org.id, userId: session.user.id, targetType: "Conversation", targetId: id, meta: { to: input.assigneeId }, ip: clientIp(req) });
  }
  await publish(`org:${session.org.id}`, "conversation.updated", { conversationId: id });
  const updated = await tdb.conversation.findUniqueOrThrow({ where: { id }, include: conversationInclude });
  return NextResponse.json({ conversation: conversationView(updated) });
});
