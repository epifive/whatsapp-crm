import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/auth/token";

/**
 * Landing spot when a page finds the session invalid (e.g. revoked by a password reset while the
 * signed token is still unexpired). Clears the cookie only if the session really is invalid, so
 * it can't be abused to log people out; avoids a /login <-> /app redirect loop.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (session) return NextResponse.redirect(new URL("/app", req.url));
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
