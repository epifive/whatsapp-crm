import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { logActivity } from "@/lib/crm/activity";
import { ensureTags } from "@/lib/crm/contacts";

type Ctx = RouteContext<"/api/contacts/[id]/tags">;

/** Add a tag (created on first use) to a contact */
export const POST = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1).max(30) }));
  const tdb = orgDb(session.org.id);
  if (!(await tdb.contact.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Contact not found.");

  const [tag] = await ensureTags(tdb, session.org.id, [name]);
  if (!tag) throw new ApiError(400, "Invalid tag.");
  const { count } = await db.contactTag.createMany({ data: [{ contactId: id, tagId: tag.id }], skipDuplicates: true });
  if (count) await logActivity({ orgId: session.org.id, contactId: id, actorId: session.user.id, type: "tag.added", data: { tag: tag.name } });
  await publish(`org:${session.org.id}`, "contact.updated", { contactId: id });
  return NextResponse.json({ tag: { id: tag.id, name: tag.name, color: tag.color } }, { status: 201 });
});

/** DELETE ?tagId= : remove a tag from a contact */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tagId = req.nextUrl.searchParams.get("tagId") ?? "";
  const tdb = orgDb(session.org.id);
  // Both sides must belong to this workspace (ContactTag itself has no orgId)
  const [contact, tag] = await Promise.all([tdb.contact.findUnique({ where: { id }, select: { id: true } }), tdb.tag.findUnique({ where: { id: tagId }, select: { id: true, name: true } })]);
  if (!contact || !tag) throw new ApiError(404, "Not found.");
  const { count } = await db.contactTag.deleteMany({ where: { contactId: id, tagId } });
  if (count) await logActivity({ orgId: session.org.id, contactId: id, actorId: session.user.id, type: "tag.removed", data: { tag: tag.name } });
  await publish(`org:${session.org.id}`, "contact.updated", { contactId: id });
  return NextResponse.json({ ok: true });
});
