import type { Campaign } from "@/generated/prisma/client";
import type { OrgDb } from "@/lib/tenancy";
import { templateSpec } from "@/lib/whatsapp/templates";
import { audienceCounts } from "./audience";
import { audienceSchema, CAMPAIGN_MEDIA_TYPES, campaignMediaSchema, templateParamsSchema } from "./schema";

/**
 * Everything that must be right before a campaign may be scheduled. Returns the problems in
 * plain language (empty when it is ready) plus the current audience size.
 */
export async function launchProblems(tdb: OrgDb, c: Campaign): Promise<{ problems: string[]; audience: number }> {
  const problems: string[] = [];
  const account = await tdb.whatsAppAccount.findUnique({ where: { id: c.accountId } });
  if (!account) return { problems: ["The WhatsApp number was removed."], audience: 0 };

  let audience = 0;
  try {
    audience = (await audienceCounts(tdb, audienceSchema.parse(c.audience))).count;
    if (!audience) problems.push("No contacts match the audience.");
  } catch (err) {
    problems.push((err as Error).message);
  }

  const media = c.media ? campaignMediaSchema.safeParse(c.media).data : null;
  if (c.media && !media) problems.push("The attached file is invalid.");

  if (account.channel === "OFFICIAL") {
    const template = c.templateId ? await tdb.template.findUnique({ where: { id: c.templateId } }) : null;
    if (!template || template.accountId !== account.id) problems.push("Choose an approved template for this number.");
    else if (template.status !== "APPROVED") problems.push(`The template "${template.name}" is not approved (${template.status.toLowerCase()}).`);
    else {
      const spec = templateSpec(template.components);
      const params = templateParamsSchema.safeParse(c.templateParams ?? {}).data ?? { header: [], body: [], buttons: {} };
      const missing = (p: { source: string; value: string } | undefined) => !p || (p.source === "text" && !p.value.trim());
      if ((spec.header?.vars ?? []).some((_, i) => missing(params.header[i])) || spec.body.some((_, i) => missing(params.body[i]))) {
        problems.push("Fill in every template variable.");
      }
      if (spec.buttons.some((b) => missing(params.buttons[String(b.index)]))) problems.push("Fill in the template's button value.");
      const format = spec.header?.format;
      if (format && format !== "TEXT" && format !== "LOCATION") {
        if (!media) problems.push(`Attach the ${format.toLowerCase()} for the template header.`);
        else if (CAMPAIGN_MEDIA_TYPES[media.mimeType] !== format) problems.push(`The template header needs a ${format.toLowerCase()} file.`);
      }
    }
  } else {
    if (!c.body?.trim() && !media) problems.push("Write the message or attach a file.");
  }
  return { problems, audience };
}
