import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/ai/knowledge/[id]">;

const patchBody = z.object({
  title: z.string().trim().min(1).max(150).optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  if (!(await tdb.knowledgeArticle.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Article not found.");
  await tdb.knowledgeArticle.update({ where: { id }, data: input });
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).knowledgeArticle.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Article not found.");
  return NextResponse.json({ ok: true });
});
