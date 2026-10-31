import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { orgDb } from "@/lib/tenancy";

const MAX_ARTICLES = 200;

const articleBody = z.object({
  title: z.string().trim().min(1, "Give the article a title.").max(150),
  content: z.string().trim().min(1, "Write the content.").max(20_000, "Keep each article under 20,000 characters; split longer ones."),
  isActive: z.boolean().default(true),
});

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const rows = await orgDb(session.org.id).knowledgeArticle.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json({ articles: rows.map((a) => ({ id: a.id, title: a.title, content: a.content, isActive: a.isActive, updatedAt: a.updatedAt })) });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, articleBody);
  const tdb = orgDb(session.org.id);
  if ((await tdb.knowledgeArticle.count()) >= MAX_ARTICLES) throw new ApiError(400, `You can have up to ${MAX_ARTICLES} articles.`);
  const a = await tdb.knowledgeArticle.create({ data: { orgId: session.org.id, ...input } });
  return NextResponse.json({ article: { id: a.id } }, { status: 201 });
});
