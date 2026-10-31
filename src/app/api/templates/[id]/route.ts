import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { deleteTemplate, GraphApiError } from "@/lib/whatsapp/official/client";

/** Deletes the template at Meta and here (campaigns that used it keep their history) */
export const DELETE = route<RouteContext<"/api/templates/[id]">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const template = await tdb.template.findUnique({ where: { id }, include: { account: true } });
  if (!template) throw new ApiError(404, "Template not found.");
  const { account } = template;
  if (account.wabaId && account.accessTokenEnc) {
    try {
      await deleteTemplate(account.wabaId, decrypt(account.accessTokenEnc), template.name, template.externalId);
    } catch (err) {
      // Already gone at Meta: just remove our copy
      const gone = err instanceof GraphApiError && /not (be )?found|does not exist|doesn't exist/i.test(err.message);
      if (!gone) throw new ApiError(400, `Meta could not delete the template: ${err instanceof GraphApiError ? err.message : "unreachable"}`);
    }
  }
  await tdb.template.delete({ where: { id } });
  await audit({ action: "whatsapp.template_deleted", orgId: session.org.id, userId: session.user.id, targetType: "template", targetId: id, meta: { name: template.name }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "templates.changed", { accountId: account.id });
  return NextResponse.json({ ok: true });
});
