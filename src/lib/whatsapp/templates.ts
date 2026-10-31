import { z } from "zod";

/**
 * WhatsApp Cloud API message templates: reading Meta's component format, building send
 * payloads, rendering previews, and validating templates created in our template builder.
 *
 * Variables are positional ({{1}}, {{2}}) or named ({{first_name}}), as Meta allows both.
 */

export interface TemplateButton {
  type: string; // QUICK_REPLY | URL | PHONE_NUMBER | COPY_CODE | ...
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[] | string;
}

export interface TemplateComponent {
  type: string; // HEADER | BODY | FOOTER | BUTTONS
  format?: string; // HEADER: TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION
  text?: string;
  buttons?: TemplateButton[];
  example?: unknown;
}

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION";

/** What a template needs filled in when it is sent */
export interface TemplateSpec {
  header: { format: HeaderFormat; vars: string[] } | null;
  body: string[];
  // Buttons with a parameter: a dynamic URL suffix or a coupon code
  buttons: { index: number; type: "URL" | "COPY_CODE"; vars: string[] }[];
  named: boolean;
}

const VAR_RE = /{{\s*([A-Za-z0-9_]+)\s*}}/g;

/** Distinct variables in order of first appearance: "Hi {{1}}, {{2}}" -> ["1", "2"] */
export function variablesIn(text: string | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  // Positional variables are sent in numeric order
  return seen.every((v) => /^\d+$/.test(v)) ? seen.sort((a, b) => Number(a) - Number(b)) : seen;
}

function list(components: unknown): TemplateComponent[] {
  return (Array.isArray(components) ? components : []) as TemplateComponent[];
}

export function templateSpec(components: unknown): TemplateSpec {
  const comps = list(components);
  const header = comps.find((c) => c.type === "HEADER");
  const body = comps.find((c) => c.type === "BODY");
  const buttons = comps.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  const bodyVars = variablesIn(body?.text);
  const headerVars = header && (header.format ?? "TEXT") === "TEXT" ? variablesIn(header.text) : [];
  return {
    header: header ? { format: (header.format ?? "TEXT") as HeaderFormat, vars: headerVars } : null,
    body: bodyVars,
    buttons: buttons.flatMap((b, index): TemplateSpec["buttons"] => {
      if (b.type === "URL" && b.url && variablesIn(b.url).length) return [{ index, type: "URL" as const, vars: variablesIn(b.url) }];
      if (b.type === "COPY_CODE") return [{ index, type: "COPY_CODE" as const, vars: ["code"] }];
      return [];
    }),
    named: [...headerVars, ...bodyVars].some((v) => !/^\d+$/.test(v)),
  };
}

/** Short shape used by the inbox composer */
export function templateVariables(components: unknown): { header: number; body: number; mediaHeader: boolean } {
  const spec = templateSpec(components);
  return {
    header: spec.header?.vars.length ?? 0,
    body: spec.body.length,
    mediaHeader: !!spec.header && spec.header.format !== "TEXT",
  };
}

function fill(text: string | undefined, vars: string[], values: string[]): string {
  return (text ?? "").replace(VAR_RE, (_, name: string) => {
    const i = vars.indexOf(name);
    return i >= 0 ? (values[i] ?? "") : "";
  });
}

/** Text shown in the inbox / campaign preview for a template with these values */
export function renderTemplatePreview(components: unknown, headerParams: string[], bodyParams: string[]): string {
  const comps = list(components);
  const spec = templateSpec(components);
  const header = comps.find((c) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT");
  const body = comps.find((c) => c.type === "BODY");
  const footer = comps.find((c) => c.type === "FOOTER");
  return [header ? `*${fill(header.text, spec.header?.vars ?? [], headerParams)}*` : null, fill(body?.text, spec.body, bodyParams), footer?.text ? `_${footer.text}_` : null]
    .filter(Boolean)
    .join("\n\n");
}

export interface TemplateSendValues {
  header?: string[];
  body?: string[];
  // Cloud API media id (or a public https link) for a media header
  headerMedia?: { id?: string; link?: string; filename?: string };
  // Values for parameterised buttons, keyed by button index
  buttons?: Record<number, string>;
}

/**
 * The `template` object of a Cloud API send request. Pass the template's components so named
 * variables, media headers and buttons are encoded the way Meta expects.
 */
export function buildTemplatePayload(name: string, language: string, values: TemplateSendValues, components?: unknown) {
  const spec = components ? templateSpec(components) : null;
  const named = spec?.named ?? false;
  const textParam = (text: string, i: number, vars: string[]) => (named ? { type: "text", parameter_name: vars[i], text } : { type: "text", text });

  const out: Record<string, unknown>[] = [];
  const format = spec?.header?.format;
  if (values.headerMedia && format && format !== "TEXT" && format !== "LOCATION") {
    const kind = format.toLowerCase();
    const media: Record<string, string> = values.headerMedia.id ? { id: values.headerMedia.id } : { link: values.headerMedia.link ?? "" };
    if (kind === "document" && values.headerMedia.filename) media.filename = values.headerMedia.filename;
    out.push({ type: "header", parameters: [{ type: kind, [kind]: media }] });
  } else if (values.header?.length) {
    out.push({ type: "header", parameters: values.header.map((t, i) => textParam(t, i, spec?.header?.vars ?? [])) });
  }
  if (values.body?.length) out.push({ type: "body", parameters: values.body.map((t, i) => textParam(t, i, spec?.body ?? [])) });
  for (const b of spec?.buttons ?? []) {
    const value = values.buttons?.[b.index];
    if (value === undefined) continue;
    out.push(
      b.type === "URL"
        ? { type: "button", sub_type: "url", index: String(b.index), parameters: [{ type: "text", text: value }] }
        : { type: "button", sub_type: "copy_code", index: String(b.index), parameters: [{ type: "coupon_code", coupon_code: value }] },
    );
  }
  return { name, language: { code: language }, components: out };
}

// ───────────── Template builder (create & submit to Meta) ─────────────

const exampleList = z.array(z.string().trim().min(1, "Give an example for every variable.").max(200)).max(20);

export const templateCreateSchema = z
  .object({
    accountId: z.string().min(1),
    name: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,512}$/, "Name: lowercase letters, numbers and underscores only."),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Choose a language."),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    header: z
      .object({
        format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]),
        text: z.string().trim().max(60).optional(),
        examples: exampleList.default([]),
      })
      .nullable()
      .default(null),
    body: z.object({ text: z.string().trim().min(1, "Write the message.").max(1024), examples: exampleList.default([]) }),
    footer: z.string().trim().max(60).nullable().default(null),
    buttons: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(25) }),
          z.object({ type: z.literal("URL"), text: z.string().trim().min(1).max(25), url: z.string().trim().max(2000), example: z.string().trim().max(200).optional() }),
          z.object({ type: z.literal("PHONE_NUMBER"), text: z.string().trim().min(1).max(25), phone: z.string().trim().regex(/^\+?\d{8,15}$/, "Phone: country code and number.") }),
        ]),
      )
      .max(10)
      .default([]),
  })
  .superRefine((t, ctx) => {
    const bodyVars = variablesIn(t.body.text);
    if (bodyVars.some((v) => !/^\d+$/.test(v))) ctx.addIssue({ code: "custom", path: ["body", "text"], message: "Use numbered variables: {{1}}, {{2}}, …" });
    else if (bodyVars.join() !== bodyVars.map((_, i) => String(i + 1)).join()) {
      ctx.addIssue({ code: "custom", path: ["body", "text"], message: "Number the variables in order: {{1}}, {{2}}, … without gaps." });
    }
    if (t.body.examples.length !== bodyVars.length) ctx.addIssue({ code: "custom", path: ["body", "examples"], message: "Give an example for every variable." });
    // Meta rejects bodies that start or end with a variable
    if (/^\s*{{/.test(t.body.text) || /}}\s*$/.test(t.body.text)) ctx.addIssue({ code: "custom", path: ["body", "text"], message: "The message can't start or end with a variable." });
    if (t.header?.format === "TEXT") {
      if (!t.header.text) ctx.addIssue({ code: "custom", path: ["header", "text"], message: "Write the header text." });
      const hv = variablesIn(t.header.text);
      if (hv.length > 1 || (hv.length === 1 && hv[0] !== "1")) ctx.addIssue({ code: "custom", path: ["header", "text"], message: "A text header can have one variable: {{1}}." });
      if (t.header.examples.length !== hv.length) ctx.addIssue({ code: "custom", path: ["header", "examples"], message: "Give an example for the header variable." });
    }
    const urls = t.buttons.filter((b) => b.type === "URL");
    for (const b of urls) {
      if (!/^https:\/\/[^\s]+$/.test(b.url)) ctx.addIssue({ code: "custom", path: ["buttons"], message: "Links must start with https://" });
      const v = variablesIn(b.url);
      if (v.length > 1 || (v.length && !/{{\s*1\s*}}$/.test(b.url))) ctx.addIssue({ code: "custom", path: ["buttons"], message: "A link can end with one variable: …/{{1}}" });
      if (v.length && !b.example) ctx.addIssue({ code: "custom", path: ["buttons"], message: "Give an example link for the variable." });
    }
    if (urls.length > 2) ctx.addIssue({ code: "custom", path: ["buttons"], message: "Up to 2 link buttons." });
    if (t.buttons.filter((b) => b.type === "PHONE_NUMBER").length > 1) ctx.addIssue({ code: "custom", path: ["buttons"], message: "Only one call button." });
    // Meta requires quick replies to be grouped together (all before or after the others)
    const kinds = t.buttons.map((b) => (b.type === "QUICK_REPLY" ? "q" : "c")).join("");
    if (/qc+q|cq+c/.test(kinds)) ctx.addIssue({ code: "custom", path: ["buttons"], message: "Keep quick replies together, before or after the other buttons." });
  });

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;

/** Meta's component list for a new template; `headerHandle` is the uploaded sample for media headers */
export function toMetaComponents(t: TemplateCreateInput, headerHandle?: string): TemplateComponent[] {
  const out: TemplateComponent[] = [];
  if (t.header) {
    if (t.header.format === "TEXT") {
      out.push({ type: "HEADER", format: "TEXT", text: t.header.text, ...(t.header.examples.length ? { example: { header_text: t.header.examples } } : {}) });
    } else {
      out.push({ type: "HEADER", format: t.header.format, example: { header_handle: [headerHandle ?? ""] } });
    }
  }
  out.push({ type: "BODY", text: t.body.text, ...(t.body.examples.length ? { example: { body_text: [t.body.examples] } } : {}) });
  if (t.footer) out.push({ type: "FOOTER", text: t.footer });
  if (t.buttons.length) {
    out.push({
      type: "BUTTONS",
      buttons: t.buttons.map((b) =>
        b.type === "QUICK_REPLY"
          ? { type: "QUICK_REPLY", text: b.text }
          : b.type === "URL"
            ? { type: "URL", text: b.text, url: b.url, ...(b.example ? { example: [b.example] } : {}) }
            : { type: "PHONE_NUMBER", text: b.text, phone_number: b.phone.startsWith("+") ? b.phone : `+${b.phone}` },
      ),
    });
  }
  return out;
}

export const TEMPLATE_LANGUAGES = [
  "en",
  "en_US",
  "en_GB",
  "hi",
  "bn",
  "gu",
  "kn",
  "ml",
  "mr",
  "pa",
  "ta",
  "te",
  "ur",
  "ar",
  "es",
  "es_MX",
  "pt_BR",
  "fr",
  "de",
  "it",
  "id",
  "ms",
  "tr",
  "ru",
  "sw",
  "zh_CN",
] as const;
