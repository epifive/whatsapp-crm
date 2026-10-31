import { NextResponse } from "next/server";
import { requireApiOrg, route } from "@/lib/api";
import { runAi } from "@/lib/ai/engine";
import { rateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/api";

/** Checks the workspace's AI connection with a tiny request */
export const POST = route(async () => {
  const session = await requireApiOrg("ADMIN");
  if (!rateLimit(`ai-test:${session.org.id}`, 10, 60_000).ok) throw new ApiError(429, "Too many tests. Wait a minute.");
  const result = await runAi(session.org.id, "test", { system: "Reply with a short friendly greeting of at most 8 words.", messages: [{ role: "user", content: "Hello!" }], maxTokens: 40 }, session.user.id);
  return NextResponse.json({ ok: true, reply: result.text });
});
