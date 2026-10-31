import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";

// Pages that need a signed-in user. Full checks (session version, email verification, role)
// happen in each page/route via src/lib/auth/session — this is only the fast first gate.
const PROTECTED_PREFIXES = ["/app", "/admin", "/onboarding"];
const GUEST_ONLY = ["/login", "/register"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(raw);

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let res: NextResponse;

  if (isProtected && !session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname + search);
    res = NextResponse.redirect(login);
  } else if (session && GUEST_ONLY.includes(pathname)) {
    res = NextResponse.redirect(new URL("/app", req.url));
  } else {
    res = NextResponse.next();
  }

  // A cookie that no longer verifies (expired, forged, APP_KEY changed) is dropped so the
  // user lands on a clean login page instead of bouncing between redirects
  if (raw && !session) res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)"],
};
