import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { REWRITE_MODES, rewrite, suggestReply, summarize, translateIncoming } from "@/lib/ai/features";
import { rateLimit } from "@/lib/rate-limit";
import { orgDb } from "@/lib/tenancy";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suggest"), conversationId: z.string().min(1) }),
  z.object({ action: z.literal("summary"), conversationId: z.string().min(1) }),
  z.object({ action: z.literal("rewrite"), text: z.string().trim().min(1, "Write something first.").max(4000), mode: z.enum(REWRITE_MODES) }),
  z.object({ action: z.literal("translate_draft"), text: z.string().trim().min(1, "Write something first.").max(4000), language: z.string().trim().min(2).max(40) }),
  z.object({ action: z.literal("translate_message"), messageId: z.string().min(1), language: z.string().trim().min(2).max(40) }),
]);

/** Inbox AI tools for agents: suggest a reply, rewrite / translate a draft, translate a message, summarise */
export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  if (!rateLimit(`ai:${session.user.id}`, 30, 60_000).ok) throw new ApiError(429, "Too many AI requests. Wait a minute.");
  const input = await parseBody(req, body);
  const orgId = session.org.id;
  const tdb = orgDb(orgId);
  const userId = session.user.id;

  const ownConversation = async (id: string) => {
    if (!(await tdb.conversation.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Conversation not found.");
  };

  switch (input.action) {
    case "suggest":
      await ownConversation(input.conversationId);
      return NextResponse.json({ text: await suggestReply(orgId, input.conversationId, userId) });
    case "summary":
      await ownConversation(input.conversationId);
      return NextResponse.json({ text: await summarize(orgId, input.conversationId, userId) });
    case "rewrite":
      return NextResponse.json({ text: await rewrite(orgId, userId, input.text, { mode: input.mode }) });
    case "translate_draft":
      return NextResponse.json({ text: await rewrite(orgId, userId, input.text, { language: input.language }) });
    case "translate_message": {
      const m = await tdb.message.findUnique({ where: { id: input.messageId }, select: { body: true } });
      if (!m) throw new ApiError(404, "Message not found.");
      if (!m.body?.trim()) throw new ApiError(400, "This message has no text to translate.");
      return NextResponse.json({ text: await translateIncoming(orgId, userId, m.body, input.language) });
    }
  }
});
