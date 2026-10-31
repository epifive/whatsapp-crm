import { ApiError } from "@/lib/api";
import type { OrgDb } from "@/lib/tenancy";

/** Owner / assignee ids must belong to someone in this workspace */
export async function assertMember(tdb: OrgDb, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await tdb.membership.findFirst({ where: { userId }, select: { id: true } }))) throw new ApiError(400, "That person isn't a member of this workspace.");
}

export async function assertContact(tdb: OrgDb, contactId: string | null | undefined) {
  if (!contactId) return null;
  const contact = await tdb.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  if (!contact) throw new ApiError(400, "Contact not found.");
  return contact;
}

export async function assertDeal(tdb: OrgDb, dealId: string | null | undefined) {
  if (!dealId) return null;
  const deal = await tdb.deal.findUnique({ where: { id: dealId }, select: { id: true, contactId: true } });
  if (!deal) throw new ApiError(400, "Deal not found.");
  return deal;
}

export function isUniqueViolation(err: unknown) {
  return (err as { code?: string }).code === "P2002";
}
