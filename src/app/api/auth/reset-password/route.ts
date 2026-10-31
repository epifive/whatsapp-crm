import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { consumeToken } from "@/lib/auth/email-tokens";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/validation";

const body = z.object({ token: z.string().min(10).max(200), password: passwordSchema });

export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit(`reset:${ip}`, 10, 15 * 60 * 1000).ok) throw new ApiError(429, "Too many attempts. Please try again later.");

  const { token, password } = await parseBody(req, body);
  const userId = await consumeToken(token, "PASSWORD_RESET");
  if (!userId) throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.", "invalid_token");

  // New password + bumped session version: every existing session (including an attacker's) ends.
  // Resetting via the emailed link also proves the inbox, so the email counts as verified.
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: hashPassword(password), sessionVersion: { increment: 1 }, emailVerifiedAt: new Date() },
  });
  await audit({ action: "user.password_reset", userId, ip });
  return NextResponse.json({ ok: true });
});
