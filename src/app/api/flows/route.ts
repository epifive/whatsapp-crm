import { assertFeature, assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { flowView } from "@/lib/flows/schema";
import { STARTERS } from "@/lib/flows/starters";
import { db } from "@/lib/db";
import { orgDb } from "@/lib/tenancy";

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  const flows = await tdb.flow.findMany({ orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] });
  const active = await db.flowSession.groupBy({ by: ["flowId"], where: { orgId: session.org.id, status: "ACTIVE" }, _count: { _all: true } });
  const counts = new Map(active.map((a) => [a.flowId, a._count._all]));
  return NextResponse.json({ flows: flows.map((f) => flowView(f, { activeSessions: counts.get(f.id) ?? 0 })) });
});

const createBody = z.object({
  name: z.string().trim().min(1, "Give the flow a name.").max(100),
  starter: z.enum(Object.keys(STARTERS) as [string, ...string[]]).default("blank"),
});

/** New flow (inactive) from a starter */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, createBody);
  const ent = await assertFeature(session.org.id, "flows");
  await assertLimit(session.org.id, "flows", 1, ent);
  const starter = STARTERS[input.starter]!;
  const flow = await orgDb(session.org.id).flow.create({
    data: { orgId: session.org.id, name: input.name, trigger: starter.trigger, keywords: starter.keywords, graph: starter.graph() as never, createdById: session.user.id },
  });
  return NextResponse.json({ flow: flowView(flow) }, { status: 201 });
});
