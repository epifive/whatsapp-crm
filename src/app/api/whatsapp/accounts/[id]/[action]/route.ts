import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { orgDb } from "@/lib/tenancy";
import { GraphApiError, getPhoneNumber, listTemplates } from "@/lib/whatsapp/official/client";
import { sendWorkerCommand } from "@/lib/whatsapp/worker-commands";
import type { Prisma, TemplateStatus } from "@/generated/prisma/client";

const STATUSES = new Set(["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"]);

/**
 * POST /api/whatsapp/accounts/:id/connect     QR: start / show QR again · Official: re-check credentials
 * POST /api/whatsapp/accounts/:id/disconnect  QR: close the session (stays linked)
 * POST /api/whatsapp/accounts/:id/logout      QR: unlink the phone and forget the session
 * POST /api/whatsapp/accounts/:id/sync-templates  Official: import templates from Meta
 */
export const POST = route<RouteContext<"/api/whatsapp/accounts/[id]/[action]">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id, action } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const account = await tdb.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new ApiError(404, "Number not found.");

  if (action === "connect") {
    await assertFeature(session.org.id, "qr");
    if (account.channel === "QR") {
      await tdb.whatsAppAccount.update({ where: { id }, data: { status: "CONNECTING", statusMessage: null } });
      await sendWorkerCommand({ action: "qr.start", accountId: id });
    } else {
      try {
        const info = await getPhoneNumber(account.phoneNumberId!, decrypt(account.accessTokenEnc!));
        await tdb.whatsAppAccount.update({
          where: { id },
          data: { status: "CONNECTED", statusMessage: null, qualityRating: info.quality_rating ?? null, messagingTier: info.messaging_limit_tier ?? null },
        });
      } catch (err) {
        const message = err instanceof GraphApiError ? err.message : "Could not reach Meta.";
        await tdb.whatsAppAccount.update({ where: { id }, data: { status: "ERROR", statusMessage: message } });
        throw new ApiError(400, `Meta rejected the credentials: ${message}`);
      }
    }
  } else if (action === "disconnect" || action === "logout") {
    if (account.channel !== "QR") throw new ApiError(400, "Only QR numbers can be disconnected here. Remove the number instead.");
    await sendWorkerCommand({ action: action === "logout" ? "qr.logout" : "qr.stop", accountId: id });
  } else if (action === "sync-templates") {
    if (account.channel !== "OFFICIAL") throw new ApiError(400, "Templates come from the WhatsApp Cloud API.");
    let templates;
    try {
      templates = await listTemplates(account.wabaId!, decrypt(account.accessTokenEnc!));
    } catch (err) {
      throw new ApiError(400, `Could not load templates from Meta: ${err instanceof GraphApiError ? err.message : "unreachable"}`);
    }
    for (const t of templates) {
      const status = (STATUSES.has(t.status) ? t.status : "PENDING") as TemplateStatus;
      await tdb.template.upsert({
        where: { accountId_externalId: { accountId: id, externalId: t.id } },
        create: { orgId: session.org.id, accountId: id, externalId: t.id, name: t.name, language: t.language, category: t.category, status, components: t.components as Prisma.InputJsonValue },
        update: { name: t.name, language: t.language, category: t.category, status, components: t.components as Prisma.InputJsonValue },
      });
    }
    await audit({ action: "whatsapp.templates_synced", orgId: session.org.id, userId: session.user.id, targetId: id, meta: { count: templates.length }, ip: clientIp(req) });
    return NextResponse.json({ ok: true, count: templates.length });
  } else {
    throw new ApiError(404, "Unknown action.");
  }

  await audit({ action: `whatsapp.${action}`, orgId: session.org.id, userId: session.user.id, targetType: "WhatsAppAccount", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
