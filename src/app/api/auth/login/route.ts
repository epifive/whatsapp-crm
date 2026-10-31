import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { burnPasswordCheck, verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

const body = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(200) });

const INVALID = "Incorrect email or password.";

export const POST = route(async (req) => {
  const ip = clientIp(req);
  const { email, password } = await parseBody(req, body);

  // Per-account and per-network limits against password guessing
  const perAccount = rateLimit(`login:${email}`, 10, 15 * 60 * 1000);
  const perIp = rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000);
  if (!perAccount.ok || !perIp.ok) {
    throw new ApiError(429, "Too many sign-in attempts. Please wait a few minutes and try again.");
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    burnPasswordCheck(password);
    throw new ApiError(401, INVALID);
  }
  if (!verifyPassword(password, user.passwordHash)) {
    await audit({ action: "user.login_failed", userId: user.id, ip });
    throw new ApiError(401, INVALID);
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await setSessionCookie(user.id, user.sessionVersion);
  await audit({ action: "user.login", userId: user.id, ip });

  return NextResponse.json({ ok: true, verified: !!user.emailVerifiedAt });
});
