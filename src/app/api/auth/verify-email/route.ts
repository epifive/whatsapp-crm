import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { consumeToken } from "@/lib/auth/email-tokens";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

const body = z.object({ token: z.string().min(10).max(200) });

/**
 * Confirms an email address. Deliberately does NOT sign anyone in: possession of a link
 * proves the inbox, not the account password.
 */
export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit(`verify:${ip}`, 20, 15 * 60 * 1000).ok) throw new ApiError(429, "Too many attempts. Please try again later.");

  const { token } = await parseBody(req, body);
  const userId = await consumeToken(token, "EMAIL_VERIFY");
  if (!userId) throw new ApiError(400, "This verification link is invalid or has expired. Request a new one.", "invalid_token");

  await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  await audit({ action: "user.email_verified", userId, ip });
  return NextResponse.json({ ok: true });
});
