import { ApiError } from "@/lib/api";
import type { OrgDb } from "@/lib/tenancy";
import type { CampaignBody } from "./schema";

/**
 * Ids in a campaign body must point at this workspace's own number, template, segment, tags
 * and uploaded file. Returns the Prisma data to store.
 */
export async function campaignData(tdb: OrgDb, orgId: string, input: Partial<CampaignBody>) {
  const account = input.accountId ? await tdb.whatsAppAccount.findUnique({ where: { id: input.accountId }, select: { id: true, channel: true } }) : null;
  if (input.accountId && !account) throw new ApiError(400, "WhatsApp number not found.");
  if (input.templateId) {
    const template = await tdb.template.findUnique({ where: { id: input.templateId }, select: { accountId: true } });
    if (!template || (account && template.accountId !== account.id)) throw new ApiError(400, "Template not found for this number.");
  }
  if (input.audience?.segmentId && !(await tdb.segment.findUnique({ where: { id: input.audience.segmentId }, select: { id: true } }))) {
    throw new ApiError(400, "Segment not found.");
  }
  if (input.audience?.tagIds.length && (await tdb.tag.count({ where: { id: { in: input.audience.tagIds } } })) !== new Set(input.audience.tagIds).size) {
    throw new ApiError(400, "Tag not found.");
  }
  // Uploaded files live under the workspace's own folder
  if (input.media && !input.media.storageKey.startsWith(`${orgId}/`)) throw new ApiError(400, "Invalid file.");

  const official = account?.channel === "OFFICIAL";
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    ...(input.audience !== undefined ? { audience: input.audience, segmentId: input.audience.type === "segment" ? (input.audience.segmentId ?? null) : null } : {}),
    // Channel decides the content: a template for Cloud API numbers, free text for QR numbers
    ...(input.templateId !== undefined ? { templateId: account && !official ? null : input.templateId } : {}),
    ...(input.templateParams !== undefined ? { templateParams: input.templateParams ?? undefined } : {}),
    ...(input.body !== undefined ? { body: account && official ? null : input.body } : {}),
    ...(input.media !== undefined ? { media: input.media ?? undefined, mediaProviderId: null } : {}),
  };
}
