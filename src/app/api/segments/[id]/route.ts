import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { fieldDefs } from "@/lib/crm/contacts";
import { isUniqueViolation } from "@/lib/crm/guards";
import { compileSegment, segmentSchema } from "@/lib/crm/segments";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/segments/[id]">;

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, segmentSchema.partial());
  const tdb = orgDb(session.org.id);
  if (!(await tdb.segment.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Segment not found.");
  if (input.filter) compileSegment(input.filter, await fieldDefs(tdb));
  try {
    const segment = await tdb.segment.update({ where: { id }, data: { name: input.name, description: input.description, filter: input.filter } });
    return NextResponse.json({ segment: { id: segment.id, name: segment.name } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A segment with this name already exists.");
    throw err;
  }
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).segment.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Segment not found.");
  return NextResponse.json({ ok: true });
});
