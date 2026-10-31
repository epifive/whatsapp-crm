import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import type { OrgRole } from "@/generated/prisma/client";
import { getSession, roleAtLeast, type Session } from "@/lib/auth/session";
import { assertWritable } from "@/lib/billing/entitlements";
import { demoBlocked } from "@/lib/demo/mode";
import { PlanError, UserInputError } from "@/lib/errors";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response>;

// The current API request, so requireApiOrg can tell reads from changes
const currentRequest = new AsyncLocalStorage<{ method: string; path: string }>();

// Read-only workspaces (subscription ended, suspended) can still pay, switch or create
// workspaces, manage their account and delete things to fit their plan
const READ_ONLY_ALLOWED = ["/api/billing", "/api/orgs", "/api/auth", "/api/admin", "/api/team/members"];
const isChange = (method: string) => method === "POST" || method === "PUT" || method === "PATCH";

/**
 * Wraps a route handler: same-origin check for state-changing requests (CSRF), the live demo's
 * restrictions, consistent JSON errors, and no stack traces leaking to clients.
 */
export function route<Ctx = unknown>(handler: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertSameOrigin(req);
      const demo = demoBlocked(req.method, req.nextUrl.pathname, req.headers.get("content-type"));
      if (demo) throw new ApiError(403, demo, "demo");
      return await currentRequest.run({ method: req.method, path: req.nextUrl.pathname }, () => handler(req, ctx));
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
      }
      if (err instanceof PlanError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
      }
      if (err instanceof UserInputError) {
        return NextResponse.json({ error: err.message, ...err.details }, { status: 400 });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: err.issues[0]?.message ?? "Invalid input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
          { status: 400 },
        );
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}

// Cookie-authenticated mutations must come from our own pages (SameSite=Lax is the first line,
// this is the second). Server-to-server endpoints (webhooks, public REST API) don't use route().
function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients don't send cookies cross-site anyway
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // malformed Origin
  }
  if (!host || originHost !== host) throw new ApiError(403, "Cross-site request blocked.", "csrf");
}

export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const json = await req.json().catch(() => {
    throw new ApiError(400, "Request body must be valid JSON.");
  });
  return schema.parse(json);
}

export async function requireApiUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Please sign in.", "unauthenticated");
  if (!session.user.emailVerifiedAt) throw new ApiError(403, "Please verify your email first.", "unverified");
  return session;
}

export async function requireApiOrg(minRole: OrgRole = "AGENT") {
  const session = await requireApiUser();
  if (!session.org || !session.role) throw new ApiError(403, "Create or join an organization first.", "no_org");
  if (!roleAtLeast(session.role, minRole)) throw new ApiError(403, "You don't have permission to do that.", "forbidden");
  const request = currentRequest.getStore();
  if (request && isChange(request.method) && !READ_ONLY_ALLOWED.some((p) => request.path === p || request.path.startsWith(`${p}/`))) {
    await assertWritable(session.org.id);
  }
  return session as Session & { org: NonNullable<Session["org"]>; role: OrgRole };
}

export async function requireApiSuperAdmin() {
  const session = await requireApiUser();
  if (session.user.platformRole !== "SUPER_ADMIN") throw new ApiError(403, "Platform administrators only.", "forbidden");
  return session;
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
