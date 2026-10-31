import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { sendPasswordResetEmail } from "@/lib/auth/email-tokens";
import { rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

const body = z.object({ email: emailSchema });

// Always answers the same way so the form can't be used to discover registered emails
export const POST = route(async (req) => {
  const ip = clientIp(req);
  const { email } = await parseBody(req, body);
  if (!rateLimit(`forgot-ip:${ip}`, 10, 60 * 60 * 1000).ok) throw new ApiError(429, "Too many requests. Please try again later.");

  if (rateLimit(`forgot:${email}`, 3, 60 * 60 * 1000).ok) {
    const user = await db.user.findUnique({ where: { email } });
    if (user) await sendPasswordResetEmail(user);
  }
  return NextResponse.json({ ok: true });
});
