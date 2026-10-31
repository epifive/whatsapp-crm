"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Copy, Paperclip, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefItem, Member, PipelineItem } from "@/components/crm/types";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STEP_META, type StepType } from "./nodes";

export interface InspectorContext {
  members: Member[];
  pipelines: PipelineItem[];
  tagNames: string[];
  fields: FieldDefItem[];
  variables: string[];
}

type Data = Record<string, unknown>;

const BUILT_IN = ["first_name", "name", "phone", "email", "last_message"];

let optSeq = 0;
const newOptionId = () => `opt_${Date.now().toString(36)}${(optSeq++).toString(36)}`;

/** Text area with buttons that insert {{variables}} at the cursor */
function TemplateText({ id, label, value, onChange, vars, rows = 4, max = 1024, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; vars: string[]; rows?: number; max?: number; placeholder?: string }) {
  const t = useTranslations("flows");
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    onChange(value.slice(0, at) + token + value.slice(at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={max} placeholder={placeholder} />
      <div className="flex flex-wrap gap-1">
        <span className="text-[11px] text-muted-foreground">{t("insert")}</span>
        {vars.map((v) => (
          <button key={v} type="button" onClick={() => insert(v === "first_name" ? "{{first_name|there}}" : `{{${v}}}`)} className="rounded border bg-background px-1 font-mono text-[11px] hover:bg-muted">
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Inspector({
  type,
  data,
  onChange,
  onDelete,
  onDuplicate,
  ctx,
}: {
  type: StepType;
  data: Data;
  onChange: (patch: Data) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  ctx: InspectorContext;
}) {
  const t = useTranslations("flows");
  const [uploading, setUploading] = useState(false);
  const Icon = STEP_META[type].icon;
  const vars = [...BUILT_IN, ...ctx.fields.map((f) => f.key), ...ctx.variables.filter((v) => !BUILT_IN.includes(v))];
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");

  async function upload(file: File) {
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/campaigns/media", { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) return toast.error(json?.error ?? t("uploadFailed"));
      onChange({ media: json.media });
    } finally {
      setUploading(false);
    }
  }

  let form: React.ReactNode = null;
  switch (type) {
    case "start":
      form = <p className="text-sm text-muted-foreground">{t("startHelp")}</p>;
      break;
    case "message": {
      const media = data.media as { fileName: string } | null | undefined;
      form = (
        <>
          <TemplateText id="msg-text" label={t("messageText")} value={str("text")} onChange={(text) => onChange({ text })} vars={vars} rows={6} max={4096} placeholder={t("messagePlaceholder")} />
          <div className="grid gap-1.5">
            <Label>{t("attachment")}</Label>
            {media ? (
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Paperclip className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{media.fileName}</span>
                <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange({ media: null })} aria-label={t("removeFile")}>
                  <X />
                </Button>
              </div>
            ) : (
              <Input type="file" accept="image/jpeg,image/png,video/mp4,application/pdf" disabled={uploading} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} aria-label={t("attachment")} />
            )}
          </div>
        </>
      );
      break;
    }
    case "menu": {
      const options = (data.options as { id: string; title: string; description?: string }[] | undefined) ?? [];
      const setOptions = (next: typeof options) => onChange({ options: next });
      form = (
        <>
          <TemplateText id="menu-text" label={t("menuText")} value={str("text")} onChange={(text) => onChange({ text })} vars={vars} />
          <div className="grid gap-2">
            <Label>{t("options")}</Label>
            {options.map((o, i) => (
              <div key={o.id} className="grid gap-1 rounded-md border p-2">
                <div className="flex gap-1">
                  <Input value={o.title} maxLength={24} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={t("optionTitle", { n: i + 1 })} aria-label={t("optionTitle", { n: i + 1 })} className="h-8" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={t("removeOption")} disabled={options.length <= 1}>
                    <X />
                  </Button>
                </div>
                {options.length > 3 && (
                  <Input value={o.description ?? ""} maxLength={72} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, description: e.target.value || undefined } : x)))} placeholder={t("optionDescription")} aria-label={t("optionDescription")} className="h-7 text-xs" />
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={options.length >= 10} onClick={() => setOptions([...options, { id: newOptionId(), title: "" }])}>
              <Plus />
              {t("addOption")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("menuHint")}</p>
          </div>
          {options.length > 3 && (
            <div className="grid gap-1.5">
              <Label htmlFor="menu-btn">{t("listButton")}</Label>
              <Input id="menu-btn" value={str("listButton") || "Choose"} maxLength={20} onChange={(e) => onChange({ listButton: e.target.value })} />
            </div>
          )}
          <SaveAs value={str("saveAs")} onChange={(saveAs) => onChange({ saveAs: saveAs || null })} optional />
          <div className="grid gap-1.5">
            <Label htmlFor="menu-err">{t("errorText")}</Label>
            <Input id="menu-err" value={str("errorText")} maxLength={500} onChange={(e) => onChange({ errorText: e.target.value || undefined })} placeholder={t("menuErrorDefault")} />
          </div>
        </>
      );
      break;
    }
    case "ask":
      form = (
        <>
          <TemplateText id="ask-text" label={t("question")} value={str("text")} onChange={(text) => onChange({ text })} vars={vars} />
          <div className="grid gap-1.5">
            <Label htmlFor="ask-val">{t("expect")}</Label>
            <NativeSelect id="ask-val" value={str("validation") || "text"} onChange={(e) => onChange({ validation: e.target.value })}>
              {["text", "number", "email", "phone", "date", "yesno", "any"].map((v) => (
                <option key={v} value={v}>
                  {t(`validation.${v}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <SaveAs value={str("saveAs")} onChange={(saveAs) => onChange({ saveAs })} />
          <div className="grid gap-1.5">
            <Label htmlFor="ask-field">{t("alsoSaveTo")}</Label>
            <NativeSelect id="ask-field" value={str("saveToField")} onChange={(e) => onChange({ saveToField: e.target.value || null })}>
              <option value="">{t("dontSave")}</option>
              <option value="name">{t("field.name")}</option>
              <option value="email">{t("field.email")}</option>
              {ctx.fields.map((f) => (
                <option key={f.key} value={`field:${f.key}`}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ask-err">{t("errorText")}</Label>
            <Input id="ask-err" value={str("errorText")} maxLength={500} onChange={(e) => onChange({ errorText: e.target.value || undefined })} placeholder={t("askErrorDefault")} />
          </div>
          <p className="text-xs text-muted-foreground">{t("retriesHint")}</p>
        </>
      );
      break;
    case "condition": {
      const rules = (data.rules as { variable: string; op: string; value: string }[] | undefined) ?? [];
      const setRules = (next: typeof rules) => onChange({ rules: next });
      form = (
        <>
          <div className="flex items-center gap-2 text-sm">
            {t("matchPrefix")}
            <NativeSelect size="sm" value={str("match") || "all"} onChange={(e) => onChange({ match: e.target.value })} aria-label={t("match")}>
              <option value="all">{t("matchAll")}</option>
              <option value="any">{t("matchAny")}</option>
            </NativeSelect>
          </div>
          {rules.map((r, i) => (
            <div key={i} className="grid gap-1 rounded-md border p-2">
              <div className="flex gap-1">
                <NativeSelect size="sm" value={r.variable} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, variable: e.target.value } : x)))} aria-label={t("variable")} className="min-w-0 flex-1">
                  {[...new Set([...vars, r.variable])].filter(Boolean).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={t("removeRule")} disabled={rules.length <= 1}>
                  <X />
                </Button>
              </div>
              <div className="flex gap-1">
                <NativeSelect size="sm" value={r.op} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))} aria-label={t("operator")}>
                  {["eq", "neq", "contains", "starts_with", "empty", "not_empty", "gt", "lt"].map((op) => (
                    <option key={op} value={op}>
                      {t(`op.${op}`)}
                    </option>
                  ))}
                </NativeSelect>
                {r.op !== "empty" && r.op !== "not_empty" && (
                  <Input value={r.value} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="h-8 min-w-0 flex-1 text-xs" aria-label={t("value")} />
                )}
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={rules.length >= 10} onClick={() => setRules([...rules, { variable: "last_message", op: "contains", value: "" }])}>
            <Plus />
            {t("addRule")}
          </Button>
        </>
      );
      break;
    }
    case "delay":
      form = (
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="delay-n">{t("wait")}</Label>
            <Input id="delay-n" type="number" min={1} max={10000} value={Number(data.amount ?? 1)} onChange={(e) => onChange({ amount: Math.max(1, Number(e.target.value)) })} className="w-24" />
          </div>
          <NativeSelect value={str("unit") || "minutes"} onChange={(e) => onChange({ unit: e.target.value })} aria-label={t("unitLabel")}>
            {["minutes", "hours", "days"].map((u) => (
              <option key={u} value={u}>
                {t(`unit.${u}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      );
      break;
    case "assign":
      form = (
        <>
          <NativeSelect value={str("mode") || "round_robin"} onChange={(e) => onChange({ mode: e.target.value })} aria-label={t("assignMode")}>
            <option value="round_robin">{t("roundRobin")}</option>
            <option value="user">{t("specificTeammate")}</option>
            <option value="unassign">{t("unassign")}</option>
          </NativeSelect>
          {data.mode === "user" && (
            <NativeSelect value={str("userId")} onChange={(e) => onChange({ userId: e.target.value || null })} aria-label={t("teammate")}>
              <option value="">{t("chooseTeammate")}</option>
              {ctx.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <p className="text-xs text-muted-foreground">{t("assignHint")}</p>
        </>
      );
      break;
    case "tags":
      form = (
        <>
          <TagList label={t("addTags")} value={(data.add as string[]) ?? []} onChange={(add) => onChange({ add })} suggestions={ctx.tagNames} />
          <TagList label={t("removeTags")} value={(data.remove as string[]) ?? []} onChange={(remove) => onChange({ remove })} suggestions={ctx.tagNames} />
        </>
      );
      break;
    case "setField": {
      const field = str("field") || "name";
      form = (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="sf-field">{t("fieldLabel")}</Label>
            <NativeSelect id="sf-field" value={field} onChange={(e) => onChange({ field: e.target.value })}>
              <option value="name">{t("field.name")}</option>
              <option value="email">{t("field.email")}</option>
              <option value="opt_in">{t("field.opt_in")}</option>
              <option value="opt_out">{t("field.opt_out")}</option>
              {ctx.fields.map((f) => (
                <option key={f.key} value={`field:${f.key}`}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          {field !== "opt_in" && field !== "opt_out" && <TemplateText id="sf-value" label={t("value")} value={str("value")} onChange={(value) => onChange({ value })} vars={vars} rows={2} max={1000} />}
        </>
      );
      break;
    }
    case "deal": {
      const pipeline = ctx.pipelines.find((p) => p.id === data.pipelineId) ?? ctx.pipelines[0];
      form = (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="deal-p">{t("pipeline")}</Label>
            <NativeSelect id="deal-p" value={pipeline?.id ?? ""} onChange={(e) => onChange({ pipelineId: e.target.value, stageId: ctx.pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id ?? "" })}>
              {ctx.pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="deal-s">{t("stage")}</Label>
            <NativeSelect id="deal-s" value={str("stageId")} onChange={(e) => onChange({ stageId: e.target.value, pipelineId: pipeline?.id })}>
              <option value="">{t("chooseStage")}</option>
              {pipeline?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TemplateText id="deal-title" label={t("dealTitle")} value={str("title")} onChange={(title) => onChange({ title })} vars={vars} rows={2} max={120} />
          <div className="grid gap-1.5">
            <Label htmlFor="deal-v">{t("dealValue")}</Label>
            <Input id="deal-v" value={str("value")} onChange={(e) => onChange({ value: e.target.value })} placeholder="0 or {{budget}}" />
          </div>
        </>
      );
      break;
    }
    case "webhook":
      form = (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="wh-url">{t("webhookUrl")}</Label>
            <Input id="wh-url" type="url" value={str("url")} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://example.com/whatsapp-bot" />
          </div>
          <SaveAs value={str("saveAs")} onChange={(saveAs) => onChange({ saveAs: saveAs || null })} optional label={t("saveResponseAs")} />
          <p className="text-xs text-muted-foreground">{t("webhookHint")}</p>
        </>
      );
      break;
    case "ai":
      form = (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-instr">{t("aiInstructions")}</Label>
            <Textarea id="ai-instr" value={str("instructions")} onChange={(e) => onChange({ instructions: e.target.value })} rows={4} maxLength={1000} placeholder={t("aiInstructionsPlaceholder")} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={data.keepChatting === true} onChange={(e) => onChange({ keepChatting: e.target.checked })} className="mt-0.5 size-4 accent-primary" />
            <span>
              {t("keepChatting")}
              <span className="block text-xs text-muted-foreground">{t("keepChattingHint")}</span>
            </span>
          </label>
          {data.keepChatting === true && (
            <div className="grid gap-1.5">
              <Label htmlFor="ai-turns">{t("maxTurns")}</Label>
              <Input id="ai-turns" type="number" min={1} max={20} value={Number(data.maxTurns ?? 5)} onChange={(e) => onChange({ maxTurns: Math.min(20, Math.max(1, Number(e.target.value))) })} className="w-24" />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("aiHint")}</p>
        </>
      );
      break;
    case "end":
      form = (
        <>
          <TemplateText id="end-text" label={t("closingMessage")} value={str("text")} onChange={(text) => onChange({ text })} vars={vars} rows={3} max={4096} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={data.close === true} onChange={(e) => onChange({ close: e.target.checked })} className="size-4 accent-primary" />
            {t("closeChat")}
          </label>
        </>
      );
      break;
  }

  return (
    <div className="grid gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md text-white" style={{ backgroundColor: STEP_META[type].color }}>
          <Icon className="size-4" />
        </span>
        <h2 className="flex-1 font-semibold">{t(`type.${type}`)}</h2>
        {type !== "start" && (
          <>
            <Button variant="ghost" size="icon-sm" onClick={onDuplicate} aria-label={t("duplicateStep")}>
              <Copy />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("deleteStep")}>
              <Trash2 className="text-muted-foreground" />
            </Button>
          </>
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t(`help.${type}`)}</p>
      {form}
    </div>
  );
}

function SaveAs({ value, onChange, optional, label }: { value: string; onChange: (v: string) => void; optional?: boolean; label?: string }) {
  const t = useTranslations("flows");
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="save-as">{label ?? (optional ? t("saveChoiceAs") : t("saveAnswerAs"))}</Label>
      <Input
        id="save-as"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40))}
        placeholder={optional ? t("optional") : "city"}
        className="font-mono"
      />
      {value && <p className="text-xs text-muted-foreground">{t("useAs", { variable: `{{${value}}}` })}</p>}
    </div>
  );
}

function TagList({ label, value, onChange, suggestions }: { label: string; value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const t = useTranslations("flows");
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, 30);
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            {tag}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== tag))} aria-label={t("removeTag", { tag })}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={draft}
          list="flow-tags"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-8"
          placeholder={t("tagPlaceholder")}
          aria-label={label}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          {t("add")}
        </Button>
      </div>
      <datalist id="flow-tags">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
