import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { sendVerificationEmail } from "@/lib/auth/email-tokens";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation";

const body = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema });

export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit(`register:${ip}`, 5, 60 * 60 * 1000).ok) {
    throw new ApiError(429, "Too many sign-ups from your network. Please try again later.");
  }
  const { name, email, password } = await parseBody(req, body);

  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ApiError(409, "An account with this email already exists. Sign in or reset your password.", "email_taken");
  }

  const user = await db.user.create({ data: { name, email, passwordHash: hashPassword(password) } });
  await sendVerificationEmail(user);
  await audit({ action: "user.registered", userId: user.id, ip });

  // Signed in but unverified: the app only lets them see the "check your email" page
  await setSessionCookie(user.id, user.sessionVersion);
  return NextResponse.json({ ok: true }, { status: 201 });
});
