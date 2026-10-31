import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth/session";

export const POST = route(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
