import { spin } from "@/lib/whatsapp/anti-ban";
import { buildTemplatePayload, renderTemplatePreview, templateSpec } from "@/lib/whatsapp/templates";
import type { MessageType } from "@/generated/prisma/client";
import { CAMPAIGN_MEDIA_TYPES, type CampaignMedia, type ParamSource, type TemplateParams } from "./schema";

export interface RenderContact {
  phone: string;
  name: string | null;
  waName: string | null;
  email: string | null;
  fields: unknown;
}

/** Values a message can use: {{name}}, {{first_name}}, {{phone}}, {{email}} and every custom field key */
export function contactVariables(c: RenderContact): Record<string, string> {
  const name = c.name || c.waName || "";
  const fields = (c.fields && typeof c.fields === "object" ? c.fields : {}) as Record<string, unknown>;
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) vars[k] = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  return { ...vars, name, first_name: name.split(/\s+/)[0] ?? "", phone: `+${c.phone}`, email: c.email ?? "" };
}

/**
 * Fills {{variable}} and {{variable|fallback}}, then picks one option of every {spin|text}.
 * Values are swapped for placeholders while spinning, so a value containing "|" or braces is
 * never treated as spintax.
 */
export function renderCampaignText(text: string, vars: Record<string, string>): string {
  const values: string[] = [];
  const withSlots = text.replace(/{{\s*([A-Za-z0-9_]+)\s*(?:\|([^{}]*))?}}/g, (_, key: string, fallback?: string) => {
    values.push(vars[key.toLowerCase()] || vars[key] || (fallback ?? "").trim());
    return `\u0000${values.length - 1}\u0000`;
  });
  return spin(withSlots)
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => values[Number(i)] ?? "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function resolveParam(p: ParamSource, vars: Record<string, string>): string {
  if (p.source === "text") return p.value.trim();
  const key = p.source.startsWith("field:") ? p.source.slice(6) : p.source;
  return (vars[key] ?? "").trim() || p.value.trim();
}

export interface CampaignContent {
  type: MessageType;
  body: string | null;
  media: CampaignMedia | null;
  payload: Record<string, unknown> | null;
}

export class RenderError extends Error {}

/** The message one contact receives from an Official (template) campaign */
export function renderTemplateMessage(
  template: { id: string; name: string; language: string; components: unknown },
  params: TemplateParams,
  vars: Record<string, string>,
  headerMedia: { id?: string; filename?: string } | null,
): CampaignContent {
  const spec = templateSpec(template.components);
  const value = (p: ParamSource | undefined, label: string) => {
    const v = p ? resolveParam(p, vars) : "";
    // Meta rejects empty parameters, so a contact without the value is skipped
    if (!v) throw new RenderError(`No value for ${label}.`);
    return v;
  };
  const header = (spec.header?.vars ?? []).map((v, i) => value(params.header[i], `the header {{${v}}}`));
  const body = spec.body.map((v, i) => value(params.body[i], `{{${v}}}`));
  const buttons: Record<number, string> = {};
  for (const b of spec.buttons) buttons[b.index] = value(params.buttons[String(b.index)], `button ${b.index + 1}`);
  if (spec.header && spec.header.format !== "TEXT" && spec.header.format !== "LOCATION" && !headerMedia?.id) throw new RenderError("The template's media header has no file.");

  return {
    type: "TEMPLATE",
    body: renderTemplatePreview(template.components, header, body),
    media: null,
    payload: {
      templateId: template.id,
      template: buildTemplatePayload(template.name, template.language, { header, body, buttons, headerMedia: headerMedia ?? undefined }, template.components),
    },
  };
}

/** The message one contact receives from a QR campaign (text with spintax, optional media) */
export function renderQrMessage(body: string | null, media: CampaignMedia | null, vars: Record<string, string>): CampaignContent {
  const text = body ? renderCampaignText(body, vars) : "";
  if (!text && !media) throw new RenderError("The message is empty.");
  return {
    type: media ? (CAMPAIGN_MEDIA_TYPES[media.mimeType] ?? "DOCUMENT") : "TEXT",
    body: text || null,
    media,
    payload: null,
  };
}
