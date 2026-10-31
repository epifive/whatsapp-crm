import { NextResponse } from "next/server";
import { clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { planBody } from "@/lib/billing/admin-schemas";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";

export const POST = route(async (req) => {
  const session = await requireApiSuperAdmin();
  const input = await parseBody(req, planBody((await getBilling()).currency));
  const plan = await db.plan.create({ data: { ...input, description: input.description || null } });
  await audit({ action: "plan.created", userId: session.user.id, targetType: "plan", targetId: plan.id, meta: { name: plan.name }, ip: clientIp(req) });
  return NextResponse.json({ plan: { id: plan.id } }, { status: 201 });
});
