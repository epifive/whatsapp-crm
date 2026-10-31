import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { contactVariables, renderQrMessage, renderTemplateMessage, RenderError } from "@/lib/campaigns/render";
import { campaignMediaSchema, templateParamsSchema } from "@/lib/campaigns/schema";
import { decrypt } from "@/lib/crypto";
import { readMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { GraphApiError, uploadMedia } from "@/lib/whatsapp/official/client";
import { queueOutbound } from "@/lib/whatsapp/outbound";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";

/** Sends the campaign's message to one phone number (e.g. your own) to check how it looks */
export const POST = route<RouteContext<"/api/campaigns/[id]/test">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { phone: rawPhone } = await parseBody(req, z.object({ phone: z.string().trim().min(1).max(30) }));
  const tdb = orgDb(session.org.id);
  const campaign = await tdb.campaign.findUnique({ where: { id }, include: { account: true, template: true } });
  if (!campaign) throw new ApiError(404, "Campaign not found.");
  const phone = normalizePhone(rawPhone);
  if (!isValidPhone(phone)) throw new ApiError(400, "Enter the phone number with country code.");
  const { account } = campaign;
  if (account.status !== "CONNECTED") throw new ApiError(400, "The WhatsApp number isn't connected.");

  const contact = await tdb.contact.upsert({
    where: { orgId_phone: { orgId: session.org.id, phone } },
    create: { orgId: session.org.id, phone, source: "manual" },
    update: {},
  });
  const vars = contactVariables(contact);
  const media = campaign.media ? campaignMediaSchema.parse(campaign.media) : null;
  let content;
  try {
    if (account.channel === "OFFICIAL") {
      if (!campaign.template || campaign.template.status !== "APPROVED") throw new RenderError("Choose an approved template first.");
      let headerMedia = null;
      if (media) {
        try {
          headerMedia = {
            filename: media.fileName,
            id: await uploadMedia(account.phoneNumberId!, decrypt(account.accessTokenEnc!), { data: await readMedia(media.storageKey), mimeType: media.mimeType, fileName: media.fileName }),
          };
        } catch (err) {
          throw new ApiError(400, `Could not upload the file to Meta: ${err instanceof GraphApiError ? err.message : "unreachable"}`);
        }
      }
      content = renderTemplateMessage(campaign.template, templateParamsSchema.parse(campaign.templateParams ?? {}), vars, headerMedia);
    } else {
      content = renderQrMessage(campaign.body, media, vars);
    }
  } catch (err) {
    if (err instanceof RenderError) throw new ApiError(400, `Test not sent: ${err.message}`);
    throw err;
  }

  const conversation = await tdb.conversation.upsert({
    where: { accountId_contactId: { accountId: account.id, contactId: contact.id } },
    create: { orgId: session.org.id, accountId: account.id, contactId: contact.id },
    update: {},
  });
  const message = await queueOutbound({
    orgId: session.org.id,
    conversationId: conversation.id,
    accountId: account.id,
    type: content.type,
    body: content.body,
    media: content.media,
    payload: content.payload,
    sentById: session.user.id,
  });
  return NextResponse.json({ ok: true, messageId: message.id, conversationId: conversation.id, preview: content.body });
});
