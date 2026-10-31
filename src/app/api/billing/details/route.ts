import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const body = z.object({
  name: z.string().trim().min(1, "Enter the name to show on invoices.").max(150),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.").max(254)]),
  address: z.string().trim().max(500),
  taxId: z.string().trim().max(50),
});

/** Name, email, address and tax id printed on new invoices */
export const PUT = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, body);
  await db.organization.update({
    where: { id: session.org.id },
    data: { billingName: input.name, billingEmail: input.email || null, billingAddress: input.address || null, billingTaxId: input.taxId || null },
  });
  await audit({ action: "billing.details_updated", orgId: session.org.id, userId: session.user.id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
