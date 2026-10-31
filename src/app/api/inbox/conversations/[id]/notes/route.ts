import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

const body = z.object({ body: z.string().trim().min(1, "Write a note.").max(4000) });

/** Internal note about the conversation's contact (never sent to the customer) */
export const POST = route<RouteContext<"/api/inbox/conversations/[id]/notes">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const tdb = orgDb(session.org.id);
  const conversation = await tdb.conversation.findUnique({ where: { id }, select: { id: true, contactId: true } });
  if (!conversation) throw new ApiError(404, "Conversation not found.");
  // Notes belong to the contact, so they also show on the contact page and in other chats with them
  const note = await tdb.note.create({
    data: { orgId: session.org.id, contactId: conversation.contactId, conversationId: id, authorId: session.user.id, body: input.body },
  });
  await publish(`org:${session.org.id}`, "conversation.updated", { conversationId: id });
  await publish(`org:${session.org.id}`, "contact.updated", { contactId: conversation.contactId });
  return NextResponse.json({ note: { id: note.id, body: note.body, createdAt: note.createdAt, author: session.user.name } }, { status: 201 });
});
