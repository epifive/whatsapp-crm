import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { AGENT_TAKEOVER_MS, automationState, stopFlowsInConversation } from "@/lib/flows/engine";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { isWindowOpen } from "@/lib/whatsapp/window";
import { enqueue, QUEUES } from "@/server/queue";

const body = z.object({ action: z.enum(["stop", "pause", "resume", "start"]), flowId: z.string().min(1).optional() });

/** Inbox controls: stop the running flow, pause / resume automations, or start a flow here */
export const POST = route<RouteContext<"/api/inbox/conversations/[id]/automation">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const tdb = orgDb(session.org.id);
  if (!(await tdb.conversation.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Conversation not found.");

  if (input.action === "stop") await stopFlowsInConversation(id, `Stopped by ${session.user.name}.`);
  if (input.action === "pause") {
    await stopFlowsInConversation(id, `Paused by ${session.user.name}.`);
    await tdb.conversation.update({ where: { id }, data: { botPausedUntil: new Date(Date.now() + AGENT_TAKEOVER_MS) } });
  }
  if (input.action === "resume") await tdb.conversation.update({ where: { id }, data: { botPausedUntil: null } });
  if (input.action === "start") {
    const flow = input.flowId ? await tdb.flow.findUnique({ where: { id: input.flowId }, select: { id: true } }) : null;
    if (!flow) throw new ApiError(404, "Flow not found.");
    const chat = await tdb.conversation.findUniqueOrThrow({ where: { id }, include: { account: { select: { channel: true } } } });
    if (chat.account.channel === "OFFICIAL" && !isWindowOpen(chat.lastInboundAt)) {
      throw new ApiError(409, "The 24-hour reply window is closed. Send an approved template; the flow can start when the customer replies.", "window_closed");
    }
    await tdb.conversation.update({ where: { id }, data: { botPausedUntil: null } });
    await enqueue(QUEUES.flowStart, { flowId: flow.id, conversationId: id, variables: {} });
  }
  await publish(`org:${session.org.id}`, "conversation.updated", { conversationId: id });
  return NextResponse.json({ automation: await automationState(id) });
});
