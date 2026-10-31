import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { assertFeature, assertWritable } from "@/lib/billing/entitlements";
import { PlanError, UserInputError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/api";
import { DEMO_BLOCKED_MESSAGE, isDemo } from "@/lib/demo/mode";

/**
 * Public REST API (/api/v1/*), authenticated with workspace API keys:
 *   Authorization: Bearer wacrm_...
 * Keys are shown once; only their SHA-256 hash is stored. 120 requests per minute per key.
 */
export const API_RATE_LIMIT = 120;

export function newApiKey() {
  const key = `wacrm_${randomToken(24)}`;
  return { key, prefix: key.slice(0, 12), keyHash: hashToken(key) };
}

export interface ApiKeyAuth {
  orgId: string;
  keyId: string;
}

async function authenticate(req: NextRequest): Promise<ApiKeyAuth> {
  const header = req.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(wacrm_[A-Za-z0-9_-]{20,})$/.exec(header.trim())?.[1];
  if (!key) throw new ApiError(401, "Send your API key as: Authorization: Bearer wacrm_…", "unauthorized");
  const row = await db.apiKey.findUnique({ where: { keyHash: hashToken(key) }, select: { id: true, orgId: true, revokedAt: true, lastUsedAt: true } });
  if (!row || row.revokedAt) throw new ApiError(401, "Invalid or revoked API key.", "unauthorized");
  // Recording every request would be a write per call; once a minute is enough to show "last used"
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { orgId: row.orgId, keyId: row.id };
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx, auth: ApiKeyAuth) => Promise<Response>;

function error(status: number, message: string, code?: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { message, code: code ?? null } }, { status, headers });
}

/** Wraps a /api/v1 handler: API-key auth, per-key rate limit, JSON errors */
export function apiV1<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      if (isDemo()) return error(403, DEMO_BLOCKED_MESSAGE, "demo");
      const auth = await authenticate(req);
      const limit = rateLimit(`v1:${auth.keyId}`, API_RATE_LIMIT, 60_000);
      if (!limit.ok) return error(429, "Rate limit exceeded.", "rate_limited", { "Retry-After": String(limit.retryAfterSec) });
      const ent = await assertFeature(auth.orgId, "api");
      if (req.method !== "GET") await assertWritable(auth.orgId, ent);
      return await handler(req, ctx, auth);
    } catch (err) {
      if (err instanceof ApiError) return error(err.status, err.message, err.code);
      if (err instanceof PlanError) return error(402, err.message, err.code);
      if (err instanceof UserInputError) return error(400, err.message, "invalid");
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        return error(400, issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request.", "invalid");
      }
      console.error(`[api/v1] ${req.method} ${req.nextUrl.pathname}`, err);
      return error(500, "Something went wrong.", "server_error");
    }
  };
}

export async function jsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Send a JSON body (Content-Type: application/json).", "invalid");
  }
}
