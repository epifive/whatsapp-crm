import { getEntitlements } from "@/lib/billing/entitlements";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { AI_PROVIDERS, AiError, chat, type AiProvider, type ChatMessage, type ChatResult } from "./providers";

export type AiFeature = "suggest" | "rewrite" | "translate" | "summary" | "auto_reply" | "flow" | "test";

export interface ResolvedAi {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

/** The workspace's AI account (its own provider key), or an AiError saying it isn't set up */
export async function resolveAi(orgId: string): Promise<ResolvedAi> {
  const [cfg, ent] = await Promise.all([db.aiConfig.findUnique({ where: { orgId } }), getEntitlements(orgId)]);
  if (!ent.features.ai) throw new AiError("Your plan doesn't include the AI assistant. Upgrade your plan in Settings › Billing to use it.", "not_configured");
  if (ent.locked) throw new AiError("This workspace is read-only, so the AI assistant is paused.", "not_configured");
  if (!cfg?.apiKeyEnc || !cfg.provider || !cfg.model || !AI_PROVIDERS.includes(cfg.provider as AiProvider)) {
    throw new AiError("Connect your AI account first: add the provider, model and API key in Settings › AI assistant.", "not_configured");
  }
  return { provider: cfg.provider as AiProvider, model: cfg.model, apiKey: decrypt(cfg.apiKeyEnc) };
}

/** One AI request with the workspace's key; every request is logged in AiUsage */
export async function runAi(
  orgId: string,
  feature: AiFeature,
  req: { system: string; messages: ChatMessage[]; maxTokens?: number; temperature?: number },
  userId?: string | null,
): Promise<ChatResult> {
  const ai = await resolveAi(orgId);
  try {
    const result = await chat({ provider: ai.provider, model: ai.model, apiKey: ai.apiKey, ...req });
    if (!result.text) throw new AiError("The AI returned an empty answer.");
    await db.aiUsage.create({ data: { orgId, userId: userId ?? null, feature, provider: ai.provider, model: ai.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut } });
    return result;
  } catch (err) {
    await db.aiUsage
      .create({ data: { orgId, userId: userId ?? null, feature, provider: ai.provider, model: ai.model, ok: false, error: (err as Error).message.slice(0, 500) } })
      .catch(() => null);
    throw err;
  }
}
