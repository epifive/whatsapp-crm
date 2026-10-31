import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { isUniqueViolation } from "@/lib/crm/guards";
import { ensureDefaultPipeline, listPipelines, pipelineSchema } from "@/lib/crm/pipelines";
import { orgDb } from "@/lib/tenancy";

const MAX_PIPELINES = 10;

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  await ensureDefaultPipeline(tdb, session.org.id);
  return NextResponse.json({ pipelines: await listPipelines(tdb) });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, pipelineSchema);
  const tdb = orgDb(session.org.id);
  const count = await tdb.pipeline.count();
  if (count >= MAX_PIPELINES) throw new ApiError(400, `You can have up to ${MAX_PIPELINES} pipelines.`);
  try {
    const pipeline = await tdb.pipeline.create({
      data: {
        orgId: session.org.id,
        name: input.name,
        position: count,
        stages: { create: input.stages.map(({ name, color, kind, probability }, position) => ({ orgId: session.org.id, name, color, kind, probability, position })) },
      },
    });
    return NextResponse.json({ pipeline: { id: pipeline.id } }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A pipeline with this name already exists.");
    throw err;
  }
});
