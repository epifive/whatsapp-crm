import { UserInputError } from "@/lib/errors";

/**
 * Chat completions from OpenAI, Google Gemini or Anthropic Claude over plain HTTPS (no SDKs).
 * Base URLs can be overridden with OPENAI_BASE_URL / GEMINI_BASE_URL / ANTHROPIC_BASE_URL
 * (proxies, Azure-compatible gateways, local mocks in tests).
 */

export const AI_PROVIDERS = ["openai", "gemini", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Suggested models in the settings forms (any model name the provider accepts can be typed) */
export const SUGGESTED_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
};

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  provider: AiProvider;
  model: string;
  apiKey: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/** An AI problem with a message that can be shown to the workspace (API routes answer 400 + code) */
export class AiError extends UserInputError {
  constructor(
    message: string,
    public code: "not_configured" | "auth" | "rate_limit" | "provider" | "timeout" = "provider",
  ) {
    super(message);
    this.details = { code };
  }
}

const TIMEOUT_MS = 45_000;

function base(provider: AiProvider): string {
  const env = { openai: process.env.OPENAI_BASE_URL, gemini: process.env.GEMINI_BASE_URL, anthropic: process.env.ANTHROPIC_BASE_URL }[provider];
  const fallback = { openai: "https://api.openai.com", gemini: "https://generativelanguage.googleapis.com", anthropic: "https://api.anthropic.com" }[provider];
  return (env || fallback).replace(/\/+$/, "");
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new AiError("The AI provider didn't answer in time.", "timeout");
    throw new AiError(`Could not reach the AI provider: ${(err as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  if (!res.ok) {
    const detail = typeof json?.error === "string" ? json.error : json?.error?.message;
    if (res.status === 401 || res.status === 403) throw new AiError(`The AI provider rejected the API key${detail ? `: ${detail}` : "."}`, "auth");
    if (res.status === 429) throw new AiError(`The AI provider's rate limit or quota was reached${detail ? `: ${detail}` : "."}`, "rate_limit");
    throw new AiError(`AI provider error (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return json;
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const maxTokens = req.maxTokens ?? 600;
  const temperature = req.temperature ?? 0.4;

  if (req.provider === "openai") {
    const json = (await post(
      `${base("openai")}/v1/chat/completions`,
      { Authorization: `Bearer ${req.apiKey}` },
      { model: req.model, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: req.system }, ...req.messages] },
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: json.choices?.[0]?.message?.content?.trim() ?? "", tokensIn: json.usage?.prompt_tokens ?? 0, tokensOut: json.usage?.completion_tokens ?? 0 };
  }

  if (req.provider === "gemini") {
    const json = (await post(
      `${base("gemini")}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      { "x-goog-api-key": req.apiKey },
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: maxTokens, temperature },
      },
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    return { text, tokensIn: json.usageMetadata?.promptTokenCount ?? 0, tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0 };
  }

  // Anthropic: the conversation must start with a user turn and alternate
  const messages: ChatMessage[] = [];
  for (const m of req.messages) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else messages.push({ ...m });
  }
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(conversation continues)" });
  const json = (await post(
    `${base("anthropic")}/v1/messages`,
    { "x-api-key": req.apiKey, "anthropic-version": "2023-06-01" },
    { model: req.model, max_tokens: maxTokens, temperature, system: req.system, messages },
  )) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  return { text, tokensIn: json.usage?.input_tokens ?? 0, tokensOut: json.usage?.output_tokens ?? 0 };
}
