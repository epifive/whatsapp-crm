import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { apiV1, jsonBody } from "@/lib/api-v1";
import { apiPhone, chatFor, pickAccount } from "@/lib/api-v1-helpers";
import { orgDb } from "@/lib/tenancy";
import { isWindowOpen } from "@/lib/whatsapp/window";
import { enqueue, QUEUES } from "@/server/queue";

const body = z.object({
  phone: z.string().min(1),
  account_id: z.string().min(1).optional(),
  variables: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

/**
 * POST /api/v1/flows/:id/start — run a flow for a contact, e.g. an order-confirmation bot
 * after a purchase. `variables` are available in the flow as {{name}}.
 */
export const POST = apiV1<RouteContext<"/api/v1/flows/[id]/start">>(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const input = body.parse(await jsonBody(req));
  const tdb = orgDb(auth.orgId);
  const flow = await tdb.flow.findUnique({ where: { id } });
  if (!flow) throw new ApiError(404, "Flow not found.", "not_found");
  if (!flow.isActive) throw new ApiError(409, "Turn the flow on before starting it from the API.", "flow_inactive");
  const account = await pickAccount(tdb, input.account_id);
  const { conversation } = await chatFor(tdb, auth.orgId, account.id, apiPhone(input.phone));
  // Meta only lets a business write freely within 24 h of the customer's last message
  if (account.channel === "OFFICIAL" && !isWindowOpen(conversation.lastInboundAt)) {
    throw new ApiError(409, "This contact hasn't messaged the number in the last 24 hours, so a flow can't write to them (WhatsApp rule). Send an approved template with POST /api/v1/messages; a flow can start when they reply.", "window_closed");
  }
  const variables = Object.fromEntries(Object.entries(input.variables).map(([k, v]) => [k, String(v)]));
  await enqueue(QUEUES.flowStart, { flowId: flow.id, conversationId: conversation.id, variables });
  return NextResponse.json({ data: { status: "started", conversation_id: conversation.id } }, { status: 202 });
});
