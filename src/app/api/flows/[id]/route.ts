import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { parseGraph } from "@/lib/flows/graph";
import { flowSettingsSchema, flowView } from "@/lib/flows/schema";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/flows/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const flow = await orgDb(session.org.id).flow.findUnique({ where: { id } });
  if (!flow) throw new ApiError(404, "Flow not found.");
  return NextResponse.json({ flow: flowView(flow), graph: flow.graph });
});

const patchBody = flowSettingsSchema.partial().extend({ graph: z.unknown().optional(), isActive: z.boolean().optional() });

/** Save settings and/or the graph; activating requires a valid flow */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const flow = await tdb.flow.findUnique({ where: { id } });
  if (!flow) throw new ApiError(404, "Flow not found.");

  // Drafts may be saved half-finished; only an active flow must be complete
  let graph: unknown = input.graph;
  const willBeActive = input.isActive ?? flow.isActive;
  if (input.isActive && !flow.isActive) await assertFeature(session.org.id, "flows");
  if (graph !== undefined && willBeActive) graph = parseGraph(graph);
  else if (graph === undefined && input.isActive) parseGraph(flow.graph);
  if (graph !== undefined && !willBeActive) {
    // Still reject structurally broken input (wrong shapes), not missing pieces
    const shape = z.object({ nodes: z.array(z.unknown()).max(200), edges: z.array(z.unknown()).max(400) }).safeParse(graph);
    if (!shape.success) throw new ApiError(400, "Invalid flow.");
  }
  const trigger = input.trigger ?? flow.trigger;
  const keywords = (input.keywords ?? flow.keywords).map((k) => k.toLowerCase());
  if (willBeActive && trigger === "KEYWORD" && !keywords.length) throw new ApiError(400, "Add at least one keyword before turning the flow on.");
  if (input.accountIds?.length && (await tdb.whatsAppAccount.count({ where: { id: { in: input.accountIds } } })) !== new Set(input.accountIds).size) {
    throw new ApiError(400, "WhatsApp number not found.");
  }
  if (input.campaignId && !(await tdb.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } }))) throw new ApiError(400, "Campaign not found.");

  const updated = await tdb.flow.update({
    where: { id },
    data: {
      ...input,
      keywords: input.keywords ? keywords : undefined,
      graph: graph === undefined ? undefined : (graph as never),
    },
  });
  if (input.isActive !== undefined && input.isActive !== flow.isActive) {
    await audit({ action: input.isActive ? "flow.activated" : "flow.deactivated", orgId: session.org.id, userId: session.user.id, targetType: "flow", targetId: id, ip: clientIp(req) });
  }
  return NextResponse.json({ flow: flowView(updated), graph: updated.graph });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const flow = await tdb.flow.findUnique({ where: { id } });
  if (!flow) throw new ApiError(404, "Flow not found.");
  await tdb.flow.delete({ where: { id } });
  await audit({ action: "flow.deleted", orgId: session.org.id, userId: session.user.id, targetType: "flow", targetId: id, meta: { name: flow.name }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
