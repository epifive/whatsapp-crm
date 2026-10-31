import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { confirmPayment } from "@/lib/billing/confirm";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({
  paymentId: z.string().min(1),
  razorpay: z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) }).optional(),
  reference: z.string().trim().max(100).optional(),
});

/** After the gateway's payment page (or an offline transfer): check and activate the plan */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  if (!rateLimit(`confirm:${session.org.id}`, 30, 60_000).ok) throw new ApiError(429, "Too many requests. Wait a minute.");
  const input = await parseBody(req, body);
  return NextResponse.json(await confirmPayment(session.org.id, input.paymentId, { razorpay: input.razorpay, reference: input.reference }));
});
