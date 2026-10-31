import { NextResponse } from "next/server";
import { ApiError, route } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { sendVerificationEmail } from "@/lib/auth/email-tokens";
import { rateLimit } from "@/lib/rate-limit";

export const POST = route(async () => {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Please sign in.");
  if (session.user.emailVerifiedAt) return NextResponse.json({ ok: true, alreadyVerified: true });

  const limit = rateLimit(`resend-verify:${session.user.id}`, 3, 10 * 60 * 1000);
  if (!limit.ok) throw new ApiError(429, `Please wait ${limit.retryAfterSec}s before requesting another email.`);

  await sendVerificationEmail(session.user);
  return NextResponse.json({ ok: true });
});
