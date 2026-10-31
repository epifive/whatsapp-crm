import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { assertNotInstalled, checkRequirements, install, installSchema } from "@/lib/installer";
import { APP_VERSION } from "@/lib/version";
import { rateLimit } from "@/lib/rate-limit";

/** Installer step 1: server checks (only before installation) */
export const GET = route(async (req) => {
  assertNotInstalled();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return NextResponse.json({
    version: APP_VERSION,
    requirements: checkRequirements(),
    databaseFromEnv: !!process.env.DATABASE_URL,
    appUrl: process.env.APP_URL && !process.env.APP_URL.includes("localhost:3000") ? process.env.APP_URL : `${proto}://${host}`,
  });
});

/** Final step: install everything */
export const POST = route(async (req) => {
  assertNotInstalled();
  if (!rateLimit(`install:${clientIp(req)}`, 10, 10 * 60_000).ok) throw new ApiError(429, "Too many attempts. Wait a few minutes.");
  const input = await parseBody(req, installSchema);
  return NextResponse.json(await install(input));
});
