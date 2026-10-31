import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendTemplateEmail } from "@/lib/email-templates";
import type { AuthTokenType } from "@/generated/prisma/client";

const TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

/** Creates a single-use token (previous unused ones of the same type are revoked) */
async function issueToken(userId: string, type: AuthTokenType): Promise<string> {
  const token = randomToken();
  await db.$transaction([
    db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } }),
    db.authToken.create({ data: { userId, type, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS[type]) } }),
  ]);
  return token;
}

/**
 * Marks a token used and returns its user id, or null if it's unknown, expired or already used.
 * The conditional update makes concurrent double-use impossible.
 */
export async function consumeToken(token: string, type: AuthTokenType): Promise<string | null> {
  if (!token) return null;
  const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
  const { count } = await db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1 ? row.userId : null;
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const token = await issueToken(user.id, "EMAIL_VERIFY");
  return sendTemplateEmail("verify_email", { to: user.email, vars: { name: user.name }, url: `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}` });
}

export async function sendPasswordResetEmail(user: { id: string; email: string; name: string }) {
  const token = await issueToken(user.id, "PASSWORD_RESET");
  return sendTemplateEmail("reset_password", { to: user.email, vars: { name: user.name }, url: `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}` });
}
