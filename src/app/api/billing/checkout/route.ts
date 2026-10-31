import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { CHECKOUT_GATEWAYS, startCheckout } from "@/lib/billing/checkout";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({
  planId: z.string().min(1),
  interval: z.enum(["MONTHLY", "YEARLY"]),
  coupon: z.string().trim().max(40).optional(),
  gateway: z.enum(CHECKOUT_GATEWAYS),
});

/** Issues an invoice and starts the payment; the plan starts once the gateway confirms it */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  if (!rateLimit(`checkout:${session.org.id}`, 10, 10 * 60_000).ok) throw new ApiError(429, "Too many checkout attempts. Try again in a few minutes.");
  const input = await parseBody(req, body);
  const result = await startCheckout({ orgId: session.org.id, planId: input.planId, interval: input.interval, couponCode: input.coupon, gateway: input.gateway });
  await audit({ action: "billing.checkout_started", orgId: session.org.id, userId: session.user.id, meta: { planId: input.planId, interval: input.interval, gateway: input.gateway, result: result.kind }, ip: clientIp(req) });
  return NextResponse.json(result);
});
