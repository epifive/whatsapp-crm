import { z } from "zod";

/**
 * Who receives a campaign. Opted-out contacts are always excluded; `consent: "opted_in"`
 * additionally limits it to contacts with a recorded opt-in.
 */
export const audienceSchema = z.object({
  type: z.enum(["all", "segment", "tags"]),
  segmentId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).max(50).default([]),
  consent: z.enum(["any", "opted_in"]).default("any"),
});

export type Audience = z.infer<typeof audienceSchema>;

/**
 * Where a template variable's value comes from: fixed text, a contact attribute or a custom
 * field ("field:city"). `value` is the text itself, or the fallback when the contact has none.
 */
export const paramSourceSchema = z.object({
  source: z.union([z.enum(["text", "name", "first_name", "phone", "email"]), z.string().regex(/^field:[a-z][a-z0-9_]{0,39}$/)]),
  value: z.string().trim().max(1000).default(""),
});

export type ParamSource = z.infer<typeof paramSourceSchema>;

export const templateParamsSchema = z.object({
  header: z.array(paramSourceSchema).max(5).default([]),
  body: z.array(paramSourceSchema).max(30).default([]),
  // Keyed by button index ("0", "1", ...)
  buttons: z.record(z.string().regex(/^\d$/), paramSourceSchema).default({}),
});

export type TemplateParams = z.infer<typeof templateParamsSchema>;

export const campaignMediaSchema = z.object({
  storageKey: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(120),
  fileName: z.string().min(1).max(200),
  size: z.number().int().min(1).optional(),
});

export type CampaignMedia = z.infer<typeof campaignMediaSchema>;

export const campaignBodySchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  accountId: z.string().min(1, "Choose a WhatsApp number."),
  audience: audienceSchema,
  templateId: z.string().min(1).nullable().optional(),
  templateParams: templateParamsSchema.nullable().optional(),
  body: z.string().max(4096).nullable().optional(),
  media: campaignMediaSchema.nullable().optional(),
});

export type CampaignBody = z.infer<typeof campaignBodySchema>;

/** File types a campaign can attach (QR message or the template's media header) */
export const CAMPAIGN_MEDIA_TYPES: Record<string, "IMAGE" | "VIDEO" | "DOCUMENT"> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "video/mp4": "VIDEO",
  "application/pdf": "DOCUMENT",
};
