import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/custom-fields/[id]">;

// Key and type stay fixed: stored values, segments and message variables depend on them
const patchBody = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const field = await tdb.customField.findUnique({ where: { id } });
  if (!field) throw new ApiError(404, "Field not found.");
  if (input.options && field.type !== "SELECT") delete input.options;
  if (input.options && !input.options.length) throw new ApiError(400, "Add at least one choice.");
  const updated = await tdb.customField.update({ where: { id }, data: input });
  return NextResponse.json({ field: { id: updated.id, key: updated.key, label: updated.label, type: updated.type, options: updated.options } });
});

/** Deletes the field and removes its values from every contact */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const field = await tdb.customField.findUnique({ where: { id } });
  if (!field) throw new ApiError(404, "Field not found.");
  await tdb.customField.delete({ where: { id } });
  await db.$executeRaw`UPDATE "Contact" SET "fields" = "fields" - ${field.key}::text WHERE "orgId" = ${session.org.id} AND "fields" ? ${field.key}::text`;
  await audit({ action: "custom_field.deleted", orgId: session.org.id, userId: session.user.id, targetType: "custom_field", targetId: id, meta: { key: field.key }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
