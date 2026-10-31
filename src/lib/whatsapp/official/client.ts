/**
 * WhatsApp Cloud API (Meta Graph API) client. Only talks to graph.facebook.com (or the
 * WHATSAPP_GRAPH_BASE override used by tests), never to user-supplied hosts.
 */

const DEFAULT_GRAPH_VERSION = "v23.0";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // Cloud API document limit

function graphBase(): string {
  return (process.env.WHATSAPP_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
}

function graphVersion(): string {
  return process.env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

export class GraphApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
  }
}

async function graph<T>(
  path: string,
  token: string,
  init: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(`${graphBase()}/${graphVersion()}/${path.replace(/^\/+/, "")}`, {
    method: init.method ?? (init.json || init.form ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.json ? { "Content-Type": "application/json" } : {}),
    },
    body: init.json ? JSON.stringify(init.json) : init.form,
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_subcode?: number } } & T;
  if (!res.ok || body.error) {
    throw new GraphApiError(body.error?.message || `Graph API error ${res.status}`, res.status, body.error?.code, body.error?.error_subcode);
  }
  return body;
}

export interface PhoneNumberInfo {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
}

export function getPhoneNumber(phoneNumberId: string, token: string) {
  return graph<PhoneNumberInfo>(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`, token);
}

/** Subscribes the Meta app to the WABA's webhooks (required to receive messages) */
export function subscribeApp(wabaId: string, token: string) {
  return graph<{ success: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}

export async function sendMessage(phoneNumberId: string, token: string, payload: Record<string, unknown>): Promise<string> {
  const res = await graph<{ messages?: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    json: { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
  });
  const id = res.messages?.[0]?.id;
  if (!id) throw new GraphApiError("Cloud API did not return a message id", 502);
  return id;
}

export function markRead(phoneNumberId: string, token: string, wamid: string) {
  return graph<{ success: boolean }>(`${phoneNumberId}/messages`, token, {
    json: { messaging_product: "whatsapp", status: "read", message_id: wamid },
  });
}

export async function uploadMedia(phoneNumberId: string, token: string, file: { data: Buffer; mimeType: string; fileName: string }): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", file.mimeType);
  form.append("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName);
  const res = await graph<{ id: string }>(`${phoneNumberId}/media`, token, { form });
  return res.id;
}

/** Downloads inbound media: first resolve the short-lived URL, then fetch it with the token */
export async function downloadMedia(mediaId: string, token: string): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await graph<{ url: string; mime_type: string; file_size?: number }>(mediaId, token);
  if (meta.file_size && meta.file_size > MAX_MEDIA_BYTES) throw new GraphApiError("Media file too large", 413);
  const url = new URL(meta.url);
  // Media URLs are always served over https from Meta's CDN (lookaside.fbsbx.com); refuse anything
  // else. The configured Graph origin itself is also trusted (a local mock in tests).
  const metaCdn = url.protocol === "https:" && (url.hostname.endsWith(".fbsbx.com") || url.hostname.endsWith(".facebook.com"));
  if (!metaCdn && url.origin !== new URL(graphBase()).origin) {
    throw new GraphApiError(`Unexpected media host ${url.hostname}`, 502);
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GraphApiError(`Media download failed (${res.status})`, res.status);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_MEDIA_BYTES) throw new GraphApiError("Media file too large", 413);
  return { data, mimeType: meta.mime_type };
}

export interface GraphTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

export async function listTemplates(wabaId: string, token: string): Promise<GraphTemplate[]> {
  const out: GraphTemplate[] = [];
  let path: string | null = `${wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100`;
  for (let page = 0; path && page < 50; page++) {
    const res: { data: GraphTemplate[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph(path, token);
    out.push(...res.data);
    const after = res.paging?.next ? res.paging.cursors?.after : undefined;
    path = after ? `${wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100&after=${encodeURIComponent(after)}` : null;
  }
  return out;
}

/** Submits a new template for Meta's review; returns its id and initial status */
export function createTemplate(wabaId: string, token: string, template: { name: string; language: string; category: string; components: unknown[] }) {
  return graph<{ id: string; status: string; category: string }>(`${wabaId}/message_templates`, token, {
    json: { ...template, allow_category_change: true },
  });
}

/** Deletes one template (this language only when the id is given) */
export function deleteTemplate(wabaId: string, token: string, name: string, templateId?: string) {
  const query = new URLSearchParams({ name, ...(templateId ? { hsm_id: templateId } : {}) });
  return graph<{ success: boolean }>(`${wabaId}/message_templates?${query}`, token, { method: "DELETE" });
}

/**
 * Uploads a sample file for a media-header template through Meta's Resumable Upload API and
 * returns the "header handle" the template submission needs.
 */
export async function uploadTemplateSample(token: string, file: { data: Buffer; mimeType: string; fileName: string }): Promise<string> {
  const app = await graph<{ id: string }>("app", token);
  const query = new URLSearchParams({ file_name: file.fileName, file_length: String(file.data.length), file_type: file.mimeType });
  const session = await graph<{ id: string }>(`${app.id}/uploads?${query}`, token, { method: "POST" });
  const res = await fetch(`${graphBase()}/${graphVersion()}/${session.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_offset: "0", "Content-Type": file.mimeType },
    body: new Uint8Array(file.data),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as { h?: string; error?: { message?: string; code?: number } };
  if (!res.ok || !body.h) throw new GraphApiError(body.error?.message || `Upload failed (${res.status})`, res.status, body.error?.code);
  return body.h;
}
