import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { audienceCounts } from "@/lib/campaigns/audience";
import { audienceSchema } from "@/lib/campaigns/schema";
import { orgDb } from "@/lib/tenancy";

/** Live audience size while building a campaign */
export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const { audience } = await parseBody(req, z.object({ audience: audienceSchema }));
  return NextResponse.json(await audienceCounts(orgDb(session.org.id), audience));
});
