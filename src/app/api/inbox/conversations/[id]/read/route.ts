import { NextResponse } from "next/server";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { decrypt } from "@/lib/crypto";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { markRead } from "@/lib/whatsapp/official/client";

/** Agent opened the conversation: clear unread; on Cloud API numbers also send blue ticks */
export const POST = route<RouteContext<"/api/inbox/conversations/[id]/read">>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const conversation = await tdb.conversation.findUnique({ where: { id }, include: { account: true } });
  if (!conversation) throw new ApiError(404, "Conversation not found.");
  if (conversation.unreadCount === 0) return NextResponse.json({ ok: true });

  await tdb.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  await publish(`org:${session.org.id}`, "conversation.updated", { conversationId: id });

  const { account } = conversation;
  if (account.channel === "OFFICIAL" && account.phoneNumberId && account.accessTokenEnc) {
    const last = await tdb.message.findFirst({
      where: { conversationId: id, direction: "INBOUND", externalId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    // Best effort: a failed read receipt must not break opening the chat
    if (last?.externalId) await markRead(account.phoneNumberId, decrypt(account.accessTokenEnc), last.externalId).catch(() => null);
  }
  return NextResponse.json({ ok: true });
});
