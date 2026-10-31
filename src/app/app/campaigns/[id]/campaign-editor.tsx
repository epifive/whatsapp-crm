"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Paperclip, Rocket, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { fromLocalInput } from "@/components/crm/format";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessagePreview } from "@/components/whatsapp/message-preview";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import type { Audience, CampaignItem, CampaignMedia, ParamSource } from "../types";
import type { CampaignContext, Readiness } from "./campaign-page";

type Params = { header: ParamSource[]; body: ParamSource[]; buttons: Record<string, ParamSource> };

const BUILT_IN_VARS = ["first_name", "name", "phone", "email"];
const HEADER_ACCEPT: Record<string, string> = { IMAGE: "image/jpeg,image/png", VIDEO: "video/mp4", DOCUMENT: "application/pdf" };
const SAMPLE: Record<string, string> = { name: "Ravi Mehra", first_name: "Ravi", phone: "+91 90000 12345", email: "ravi@example.com" };

/** Example values for previews: built-ins plus "[Label]" for custom fields */
function sampleValue(source: string, value: string, fields: CampaignContext["fields"]): string {
  if (source === "text") return value;
  if (source.startsWith("field:")) return `[${fields.find((f) => `field:${f.key}` === source)?.label ?? source.slice(6)}]`;
  return SAMPLE[source] ?? value;
}

function previewText(body: string, fields: CampaignContext["fields"]): string {
  return body
    .replace(/{{\s*([A-Za-z0-9_]+)\s*(?:\|([^{}]*))?}}/g, (_, key: string, fb?: string) => SAMPLE[key] ?? (fields.some((f) => f.key === key) ? `[${fields.find((f) => f.key === key)!.label}]` : (fb ?? "")))
    .replace(/\{([^{}]*\|[^{}]*)\}/g, (_, opts: string) => opts.split("|")[0]!);
}

export function CampaignEditor({
  campaign,
  readiness,
  ctx,
  onSaved,
  onLaunched,
}: {
  campaign: CampaignItem;
  readiness: Readiness | null;
  ctx: CampaignContext;
  onSaved: (c: CampaignItem, r: Readiness | null) => void;
  onLaunched: () => void;
}) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [accountId, setAccountId] = useState(campaign.account.id);
  const [audience, setAudience] = useState<Audience>({ ...campaign.audience, tagIds: campaign.audience.tagIds ?? [] });
  const [templateId, setTemplateId] = useState(campaign.template?.id ?? "");
  const [params, setParams] = useState<Params>(campaign.templateParams ?? { header: [], body: [], buttons: {} });
  const [body, setBody] = useState(campaign.body ?? "");
  const [media, setMedia] = useState<CampaignMedia | null>(campaign.media);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [counts, setCounts] = useState<{ count: number; optedOut: number; withoutConsent: number } | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const account = ctx.accounts.find((a) => a.id === accountId)!;
  const official = account.channel === "OFFICIAL";
  const templates = ctx.templates.filter((x) => x.accountId === accountId);
  const template = templates.find((x) => x.id === templateId) ?? null;
  const spec = template?.spec;
  const needsMedia = official ? !!spec?.header && spec.header.format !== "TEXT" && spec.header.format !== "LOCATION" : true;

  // Live audience size
  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await apiFetch<{ count: number; optedOut: number; withoutConsent: number }>("/api/campaigns/audience", { body: { audience } });
      if (res.ok) {
        setCounts(res.data);
        setCountError(null);
      } else setCountError(res.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [audience]);

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const s = ctx.templates.find((x) => x.id === id)?.spec;
    // Sensible defaults: {{1}} = first name with a fallback, the rest typed in
    setParams({
      header: (s?.header?.vars ?? []).map(() => ({ source: "text", value: "" })),
      body: (s?.body ?? []).map((_, i) => (i === 0 ? { source: "first_name", value: "there" } : { source: "text", value: "" })),
      buttons: Object.fromEntries((s?.buttons ?? []).map((b) => [String(b.index), { source: "text", value: "" }])),
    });
    setMedia(null);
  }

  function insert(token: string) {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/campaigns/media", { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) return toast.error(json?.error ?? t("uploadFailed"));
      setMedia(json.media);
    } finally {
      setUploading(false);
    }
  }

  async function save(quiet = false): Promise<Readiness | null> {
    setSaving(true);
    const res = await apiFetch<{ campaign: CampaignItem; readiness: Readiness }>(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      body: {
        name,
        accountId,
        audience,
        templateId: official ? templateId || null : null,
        templateParams: official ? params : null,
        body: official ? null : body,
        media,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setError(null);
    onSaved(res.data!.campaign, res.data!.readiness);
    if (!quiet) toast.success(t("saved"));
    return res.data!.readiness;
  }

  async function launch() {
    const ready = await save(true);
    if (!ready) return;
    if (ready.problems.length) return setError(ready.problems[0]!);
    const at = when === "later" ? fromLocalInput(scheduledAt) : null;
    if (when === "later" && !at) return setError(t("pickTime"));
    if (!confirm(at ? t("confirmSchedule", { count: ready.audience }) : t("confirmLaunch", { count: ready.audience }))) return;
    const res = await apiFetch(`/api/campaigns/${campaign.id}/launch`, { body: { scheduledAt: at } });
    if (!res.ok) return setError(res.error);
    toast.success(at ? t("scheduled") : t("launched"));
    onLaunched();
  }

  async function remove() {
    if (!confirm(t("confirmDelete", { name: campaign.name }))) return;
    const res = await apiFetch(`/api/campaigns/${campaign.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    router.push("/app/campaigns");
  }

  const sourceOptions = [
    { value: "text", label: t("source.text") },
    ...BUILT_IN_VARS.map((v) => ({ value: v, label: t(`source.${v}`) })),
    ...ctx.fields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
  ];
  const avgGap = (account.minDelaySec + account.maxDelaySec) / 2 + 5;
  const estimateMinutes = counts ? Math.ceil((counts.count * avgGap) / 60) : 0;

  const paramRow = (label: string, p: ParamSource | undefined, set: (p: ParamSource) => void, key: string) => {
    const v = p ?? { source: "text", value: "" };
    return (
      <div key={key} className="grid items-center gap-2 sm:grid-cols-[6rem_12rem_minmax(0,1fr)]">
        <code className="text-sm font-medium">{label}</code>
        <NativeSelect size="sm" aria-label={t("valueFrom", { variable: label })} value={v.source} onChange={(e) => set({ source: e.target.value, value: v.value })}>
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <Input
          className="h-8 text-sm"
          value={v.value}
          onChange={(e) => set({ ...v, value: e.target.value })}
          placeholder={v.source === "text" ? t("fixedText") : t("fallback")}
          aria-label={v.source === "text" ? t("fixedText") : t("fallback")}
          maxLength={1000}
        />
      </div>
    );
  };

  const previewValues = (list: ParamSource[]) => list.map((p) => sampleValue(p.source, p.value, ctx.fields));
  const fill = (text: string | undefined, vars: string[], values: string[]) => (text ?? "").replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (m, n: string) => values[vars.indexOf(n)] || m);
  type Comp = { type: string; format?: string; text?: string; buttons?: { type: string; text?: string }[] };
  const comps = (template?.components ?? []) as Comp[];
  const headerComp = comps.find((c) => c.type === "HEADER");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/app/campaigns" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{name || t("untitled")}</h1>
          <p className="text-sm text-muted-foreground">{t("draft")}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t("delete")}>
          <Trash2 className="text-muted-foreground" />
        </Button>
      </div>
      <FormMessage type="error">{error}</FormMessage>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("step.details")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="c-name" label={t("name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
              <div className="grid gap-1.5">
                <Label htmlFor="c-account">{t("number")}</Label>
                <NativeSelect
                  id="c-account"
                  value={accountId}
                  onChange={(e) => {
                    setAccountId(e.target.value);
                    setTemplateId("");
                    setMedia(null);
                  }}
                >
                  {ctx.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {t(`channel.${a.channel}`)}
                    </option>
                  ))}
                </NativeSelect>
                {account.status !== "CONNECTED" && <p className="text-xs text-amber-600">{t("numberNotConnected")}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("step.audience")}</CardTitle>
              <CardDescription>{t("audienceHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("step.audience")}>
                {(["all", "segment", "tags"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={audience.type === type}
                    onClick={() => setAudience((a) => ({ ...a, type, segmentId: type === "segment" ? (a.segmentId ?? ctx.segments[0]?.id ?? null) : null }))}
                    className={cn("rounded-lg border px-3 py-2 text-sm", audience.type === type ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}
                  >
                    {t(`audience.${type}`)}
                  </button>
                ))}
              </div>
              {audience.type === "segment" &&
                (ctx.segments.length ? (
                  <NativeSelect aria-label={t("audience.segment")} value={audience.segmentId ?? ""} onChange={(e) => setAudience((a) => ({ ...a, segmentId: e.target.value }))} className="max-w-sm">
                    {ctx.segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("noSegments")}{" "}
                    <Link href="/app/contacts/segments" className="font-medium text-primary hover:underline">
                      {t("createSegment")}
                    </Link>
                  </p>
                ))}
              {audience.type === "tags" && (
                <div className="flex flex-wrap gap-1.5">
                  {ctx.tags.length === 0 && <p className="text-sm text-muted-foreground">{t("noTags")}</p>}
                  {ctx.tags.map((tag) => {
                    const on = audience.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAudience((a) => ({ ...a, tagIds: on ? a.tagIds.filter((x) => x !== tag.id) : [...a.tagIds, tag.id] }))}
                        className={cn("rounded px-2 py-1 text-xs font-medium", on ? "text-white" : "border bg-background text-foreground")}
                        style={on ? { backgroundColor: tag.color } : undefined}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={audience.consent === "opted_in"}
                  onChange={(e) => setAudience((a) => ({ ...a, consent: e.target.checked ? "opted_in" : "any" }))}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  {t("onlyOptedIn")}
                  <span className="block text-xs text-muted-foreground">{t("onlyOptedInHint")}</span>
                </span>
              </label>
              <div className="rounded-lg bg-muted/50 p-3 text-sm">
                {countError ? (
                  <span className="text-destructive">{countError}</span>
                ) : counts ? (
                  <>
                    <span className="font-semibold">{t("recipients", { count: counts.count })}</span>
                    {counts.optedOut > 0 && <span className="text-muted-foreground"> · {t("excludedOptedOut", { count: counts.optedOut })}</span>}
                    {counts.withoutConsent > 0 && <span className="text-muted-foreground"> · {t("excludedNoConsent", { count: counts.withoutConsent })}</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("counting")}</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("step.message")}</CardTitle>
              <CardDescription>{official ? t("officialHelp") : t("qrHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {official ? (
                <>
                  {templates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("noTemplates")}{" "}
                      <Link href={`/app/templates?account=${accountId}`} className="font-medium text-primary hover:underline">
                        {t("manageTemplates")}
                      </Link>
                    </p>
                  ) : (
                    <div className="grid gap-1.5">
                      <Label htmlFor="c-template">{t("template")}</Label>
                      <NativeSelect id="c-template" value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                        <option value="">{t("chooseTemplate")}</option>
                        {templates.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} ({x.language})
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  )}
                  {spec && (spec.header?.vars.length || spec.body.length || spec.buttons.length) ? (
                    <div className="grid gap-2 rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("mapHelp")}</p>
                      {(spec.header?.vars ?? []).map((v, i) =>
                        paramRow(`{{${v}}}`, params.header[i], (p) => setParams((x) => ({ ...x, header: Object.assign([...x.header], { [i]: p }) })), `h${i}`),
                      )}
                      {spec.body.map((v, i) => paramRow(`{{${v}}}`, params.body[i], (p) => setParams((x) => ({ ...x, body: Object.assign([...x.body], { [i]: p }) })), `b${i}`))}
                      {spec.buttons.map((b) =>
                        paramRow(
                          t(b.type === "URL" ? "buttonLink" : "buttonCode", { n: b.index + 1 }),
                          params.buttons[String(b.index)],
                          (p) => setParams((x) => ({ ...x, buttons: { ...x.buttons, [String(b.index)]: p } })),
                          `btn${b.index}`,
                        ),
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t("insert")}</span>
                    {["first_name", "name", ...ctx.fields.map((f) => f.key)].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insert(v === "first_name" ? "{{first_name|there}}" : `{{${v}}}`)}
                        className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs hover:bg-muted"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                    <button type="button" onClick={() => insert("{Hi|Hello|Hey}")} className="rounded border bg-background px-1.5 py-0.5 font-mono text-xs hover:bg-muted">
                      {"{Hi|Hello}"}
                    </button>
                    {ctx.canned.length > 0 && (
                      <NativeSelect size="sm" aria-label={t("useCanned")} value="" onChange={(e) => e.target.value && setBody(ctx.canned.find((c) => c.id === e.target.value)!.body)} className="ms-auto max-w-48">
                        <option value="">{t("useCanned")}</option>
                        {ctx.canned.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </div>
                  <Textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={4096} placeholder={t("bodyPlaceholder")} aria-label={t("step.message")} />
                  <p className="text-xs text-muted-foreground">{t("spintaxHint")}</p>
                </>
              )}

              {needsMedia && (official ? !!spec : true) && (
                <div className="grid gap-1.5">
                  <Label>{official ? t("headerFile", { format: spec?.header?.format.toLowerCase() ?? "" }) : t("attachment")}</Label>
                  {media ? (
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <Paperclip className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{media.fileName}</span>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={t("removeFile")} onClick={() => setMedia(null)}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <Input
                      type="file"
                      disabled={uploading}
                      accept={official ? (HEADER_ACCEPT[spec?.header?.format ?? ""] ?? "") : "image/jpeg,image/png,video/mp4,application/pdf"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void upload(f);
                      }}
                      aria-label={t("attachment")}
                    />
                  )}
                </div>
              )}

              {!official && (
                <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                  <ShieldCheck className="size-4 shrink-0 text-primary" />
                  <p>{t("antiBanNote", { min: account.minDelaySec, max: account.maxDelaySec, minutes: estimateMinutes })}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("step.schedule")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("step.schedule")}>
                {(["now", "later"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    role="radio"
                    aria-checked={when === w}
                    onClick={() => setWhen(w)}
                    className={cn("rounded-lg border px-3 py-2 text-sm", when === w ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}
                  >
                    {t(`when.${w}`)}
                  </button>
                ))}
              </div>
              {when === "later" && <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="max-w-xs" aria-label={t("when.later")} />}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:sticky lg:top-20">
          <div className="text-sm font-medium">{t("preview")}</div>
          {official ? (
            template ? (
              <MessagePreview
                headerFormat={headerComp?.format}
                headerText={headerComp && (headerComp.format ?? "TEXT") === "TEXT" ? fill(headerComp.text, spec?.header?.vars ?? [], previewValues(params.header)) : null}
                mediaName={media?.fileName}
                body={fill(comps.find((c) => c.type === "BODY")?.text, spec?.body ?? [], previewValues(params.body))}
                footer={comps.find((c) => c.type === "FOOTER")?.text}
                buttons={comps.find((c) => c.type === "BUTTONS")?.buttons ?? []}
              />
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("chooseTemplate")}</p>
            )
          ) : (
            <MessagePreview
              headerFormat={media ? ({ "image/jpeg": "IMAGE", "image/png": "IMAGE", "video/mp4": "VIDEO" }[media.mimeType] ?? "DOCUMENT") : null}
              mediaName={media?.fileName}
              body={previewText(body, ctx.fields)}
            />
          )}

          {readiness && (
            <div className={cn("grid gap-1.5 rounded-lg border p-3 text-sm", readiness.problems.length ? "border-amber-300 bg-amber-50 dark:bg-amber-950/40" : "border-primary/30 bg-primary/5")}>
              {readiness.problems.length ? (
                <>
                  <div className="flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="size-4 text-amber-600" />
                    {t("notReady")}
                  </div>
                  <ul className="list-disc ps-5 text-xs">
                    {readiness.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t("saveToCheck")}</p>
                </>
              ) : (
                <div className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="size-4 text-primary" />
                  {t("ready", { count: readiness.audience })}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Button onClick={launch} disabled={saving}>
              <Rocket />
              {when === "later" ? t("schedule") : t("launch")}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => void save()} disabled={saving}>
                {t("saveDraft")}
              </Button>
              <Button variant="outline" onClick={() => setTestOpen(true)} disabled={saving || account.status !== "CONNECTED"}>
                <Send />
                {t("sendTest")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {testOpen && <TestDialog campaignId={campaign.id} onClose={() => setTestOpen(false)} beforeSend={() => save(true)} />}
    </div>
  );
}

function TestDialog({ campaignId, onClose, beforeSend }: { campaignId: string; onClose: () => void; beforeSend: () => Promise<Readiness | null> }) {
  const t = useTranslations("campaigns");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const phone = new FormData(e.currentTarget).get("phone");
    setPending(true);
    await beforeSend();
    const res = await apiFetch(`/api/campaigns/${campaignId}/test`, { body: { phone } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("testSent"));
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("sendTest")}</DialogTitle>
            <DialogDescription>{t("testText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="phone" label={t("testPhone")} required inputMode="tel" placeholder="+91 90000 12345" autoFocus />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("sendTest")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
