import { NextResponse } from "next/server";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { importView } from "@/lib/crm/imports";
import { deleteMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/contacts/imports/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const imp = await orgDb(session.org.id).contactImport.findUnique({ where: { id } });
  if (!imp) throw new ApiError(404, "Import not found.");
  return NextResponse.json({ import: importView(imp) });
});

/** Discard an upload that was never started */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const imp = await tdb.contactImport.findUnique({ where: { id } });
  if (!imp) throw new ApiError(404, "Import not found.");
  if (imp.status !== "DRAFT") throw new ApiError(409, "This import has already started.");
  await tdb.contactImport.delete({ where: { id } });
  await deleteMedia(imp.storageKey).catch(() => null);
  return NextResponse.json({ ok: true });
});
