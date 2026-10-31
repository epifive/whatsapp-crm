import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { ensureDefaultPipeline, listPipelines } from "@/lib/crm/pipelines";
import { orgDb } from "@/lib/tenancy";
import { PipelinesManager } from "./pipelines-manager";

export const metadata: Metadata = { title: "Pipelines" };

export default async function PipelinesPage() {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  await ensureDefaultPipeline(tdb, session.org.id);
  return <PipelinesManager initial={await listPipelines(tdb)} canManage={roleAtLeast(session.role, "ADMIN")} />;
}
