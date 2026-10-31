import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { isUniqueViolation } from "@/lib/crm/guards";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/tags/[id]">;

const patchBody = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  if (!(await tdb.tag.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Tag not found.");
  try {
    const tag = await tdb.tag.update({ where: { id }, data: input });
    await publish(`org:${session.org.id}`, "contacts.changed");
    return NextResponse.json({ tag: { id: tag.id, name: tag.name, color: tag.color } });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A tag with this name already exists.");
    throw err;
  }
});

/** Removes the tag from every contact */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).tag.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Tag not found.");
  await publish(`org:${session.org.id}`, "contacts.changed");
  return NextResponse.json({ ok: true });
});
