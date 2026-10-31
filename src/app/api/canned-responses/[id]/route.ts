import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { orgDb } from "@/lib/tenancy";
import { cannedSchema } from "@/lib/canned";

type Ctx = RouteContext<"/api/canned-responses/[id]">;

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, cannedSchema.partial());
  const tdb = orgDb(session.org.id);
  if (!(await tdb.cannedResponse.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Not found.");
  try {
    const item = await tdb.cannedResponse.update({ where: { id }, data: input });
    return NextResponse.json({ item });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new ApiError(409, "That shortcut already exists.");
    throw err;
  }
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).cannedResponse.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Not found.");
  return NextResponse.json({ ok: true });
});
