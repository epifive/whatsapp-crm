import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isDemo } from "@/lib/demo/mode";
import { resetDemo } from "@/lib/demo/reset";

/**
 * Live demo on hosts without the background worker (e.g. Vercel): a scheduled job calls this
 * route to reset the demo data. Only works with DEMO_MODE=true and the CRON_SECRET
 * (sent as "Authorization: Bearer <secret>", which Vercel Cron does automatically).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 16) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!isDemo()) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const started = Date.now();
  await resetDemo();
  return NextResponse.json({ ok: true, durationMs: Date.now() - started });
}
