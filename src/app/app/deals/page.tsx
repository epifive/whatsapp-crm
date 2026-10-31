import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { ensureDefaultPipeline, listPipelines } from "@/lib/crm/pipelines";
import { orgDb } from "@/lib/tenancy";
import { DealsBoard } from "./deals-board";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage({ searchParams }: PageProps<"/app/deals">) {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  await ensureDefaultPipeline(tdb, session.org.id);
  const sp = await searchParams;
  const [pipelines, members] = await Promise.all([
    listPipelines(tdb),
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const requested = typeof sp.pipeline === "string" ? sp.pipeline : "";
  return (
    <DealsBoard
      pipelines={pipelines}
      members={members.map((m) => m.user)}
      meId={session.user.id}
      currency={session.org.currency}
      isAdmin={roleAtLeast(session.role, "ADMIN")}
      initialPipelineId={pipelines.some((p) => p.id === requested) ? requested : pipelines[0]!.id}
      initialDealId={typeof sp.deal === "string" ? sp.deal : null}
    />
  );
}
