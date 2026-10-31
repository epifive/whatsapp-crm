"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefItem, Member, TagItem } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";

// Mirrors the server rule format in src/lib/crm/segments.ts
type Condition =
  | { type: "tag"; op: "has" | "not_has"; tagId: string }
  | { type: "field"; key: string; op: "eq" | "neq" | "contains" | "empty" | "not_empty" | "gt" | "lt"; value?: string }
  | { type: "attr"; attr: "name" | "phone" | "email"; op: "contains" | "starts_with" | "empty" | "not_empty"; value?: string }
  | { type: "opted_out"; value: boolean }
  | { type: "opted_in"; value: boolean }
  | { type: "created"; op: "within_days" | "older_than_days"; days: number }
  | { type: "last_message"; op: "within_days" | "older_than_days" | "never"; days?: number }
  | { type: "owner"; op: "is" | "unassigned"; userId?: string }
  | { type: "deal"; op: "open" | "won" | "lost" | "none" };

interface Filter {
  match: "all" | "any";
  conditions: Condition[];
}

interface SegmentItem {
  id: string;
  name: string;
  description: string | null;
  filter: Filter;
  count: number | null;
  error: string | null;
}

const CONDITION_TYPES: Condition["type"][] = ["tag", "field", "attr", "opted_in", "opted_out", "created", "last_message", "owner", "deal"];

function defaultCondition(type: Condition["type"], tags: TagItem[], fields: FieldDefItem[]): Condition {
  switch (type) {
    case "tag":
      return { type, op: "has", tagId: tags[0]?.id ?? "" };
    case "field":
      return { type, key: fields[0]?.key ?? "", op: "eq", value: "" };
    case "attr":
      return { type, attr: "name", op: "contains", value: "" };
    case "opted_in":
    case "opted_out":
      return { type, value: true };
    case "created":
      return { type, op: "within_days", days: 30 };
    case "last_message":
      return { type, op: "within_days", days: 7 };
    case "owner":
      return { type, op: "unassigned" };
    case "deal":
      return { type, op: "open" };
  }
}

export function SegmentsManager({ fields, tags, members, canManage }: { fields: FieldDefItem[]; tags: TagItem[]; members: Member[]; canManage: boolean }) {
  const t = useTranslations("segments");
  const [segments, setSegments] = useState<SegmentItem[] | null>(null);
  const [editing, setEditing] = useState<SegmentItem | "new" | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<{ segments: SegmentItem[] }>("/api/segments");
    if (res.ok && res.data) setSegments(res.data.segments);
  }, []);

  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(s: SegmentItem) {
    if (!confirm(t("confirmDelete", { name: s.name }))) return;
    const res = await apiFetch(`/api/segments/${s.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/app/contacts" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && !editing && (
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </div>

      {editing && (
        <SegmentEditor
          key={editing === "new" ? "new" : editing.id}
          segment={editing === "new" ? null : editing}
          fields={fields}
          tags={tags}
          members={members}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <Card>
        <CardContent className="divide-y">
          {segments === null && <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
          {segments?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
          {segments?.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-48">
                <div className="font-medium">{s.name}</div>
                {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                {s.error && <p className="text-sm text-destructive">{s.error}</p>}
              </div>
              <Link href={`/app/contacts?segment=${s.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Users />
                {s.count === null ? "—" : t("contacts", { count: s.count })}
              </Link>
              {canManage && (
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => remove(s)}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SegmentEditor({
  segment,
  fields,
  tags,
  members,
  onDone,
}: {
  segment: SegmentItem | null;
  fields: FieldDefItem[];
  tags: TagItem[];
  members: Member[];
  onDone: () => void;
}) {
  const t = useTranslations("segments");
  const [filter, setFilter] = useState<Filter>(segment?.filter ?? { match: "all", conditions: [] });
  const [preview, setPreview] = useState<{ count: number; sample: { id: string; name: string; phone: string }[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Live count while editing
  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await apiFetch<{ count: number; sample: { id: string; name: string; phone: string }[] }>("/api/segments/preview", { body: { filter } });
      if (res.ok) {
        setPreview(res.data);
        setPreviewError(null);
      } else setPreviewError(res.error);
    }, 400);
    return () => clearTimeout(timer);
  }, [filter]);

  const update = (i: number, c: Condition) => setFilter((f) => ({ ...f, conditions: f.conditions.map((x, j) => (j === i ? c : x)) }));

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), description: f.get("description") || null, filter };
    setPending(true);
    const res = segment ? await apiFetch(`/api/segments/${segment.id}`, { method: "PATCH", body }) : await apiFetch("/api/segments", { body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    onDone();
  }

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>{segment ? t("edit") : t("new")}</CardTitle>
          <CardDescription>{t("editorHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label={t("name")} defaultValue={segment?.name} required maxLength={80} placeholder={t("namePlaceholder")} />
            <Field id="description" label={t("description")} defaultValue={segment?.description ?? ""} maxLength={300} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {t("matchPrefix")}
            <NativeSelect value={filter.match} onChange={(e) => setFilter((f) => ({ ...f, match: e.target.value as Filter["match"] }))} aria-label={t("match")} size="sm">
              <option value="all">{t("matchAll")}</option>
              <option value="any">{t("matchAny")}</option>
            </NativeSelect>
            {t("matchSuffix")}
          </div>

          <ul className="grid gap-2">
            {filter.conditions.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <NativeSelect
                  size="sm"
                  aria-label={t("conditionType")}
                  value={c.type}
                  onChange={(e) => update(i, defaultCondition(e.target.value as Condition["type"], tags, fields))}
                >
                  {CONDITION_TYPES.filter((type) => (type === "tag" ? tags.length : type === "field" ? fields.length : true)).map((type) => (
                    <option key={type} value={type}>
                      {t(`type.${type}`)}
                    </option>
                  ))}
                </NativeSelect>
                <ConditionInputs c={c} onChange={(next) => update(i, next)} fields={fields} tags={tags} members={members} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="ms-auto"
                  aria-label={t("removeCondition")}
                  onClick={() => setFilter((f) => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={filter.conditions.length >= 20}
            onClick={() => setFilter((f) => ({ ...f, conditions: [...f.conditions, defaultCondition(tags.length ? "tag" : "opted_in", tags, fields)] }))}
          >
            <Plus />
            {t("addCondition")}
          </Button>

          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            {previewError ? (
              <span className="text-destructive">{previewError}</span>
            ) : preview ? (
              <>
                <span className="font-medium">{t("matches", { count: preview.count })}</span>
                {preview.sample.length > 0 && <span className="text-muted-foreground"> · {preview.sample.map((s) => s.name).join(", ")}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">{t("counting")}</span>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t("cancel")}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

function ConditionInputs({
  c,
  onChange,
  fields,
  tags,
  members,
}: {
  c: Condition;
  onChange: (c: Condition) => void;
  fields: FieldDefItem[];
  tags: TagItem[];
  members: Member[];
}) {
  const t = useTranslations("segments");
  switch (c.type) {
    case "tag":
      return (
        <>
          <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            <option value="has">{t("op.has")}</option>
            <option value="not_has">{t("op.not_has")}</option>
          </NativeSelect>
          <NativeSelect size="sm" aria-label={t("type.tag")} value={c.tagId} onChange={(e) => onChange({ ...c, tagId: e.target.value })}>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </NativeSelect>
        </>
      );
    case "field": {
      const def = fields.find((f) => f.key === c.key);
      const ops = ["eq", "neq", "contains", "empty", "not_empty", ...(def?.type === "NUMBER" || def?.type === "DATE" ? ["gt", "lt"] : [])] as const;
      const needsValue = c.op !== "empty" && c.op !== "not_empty";
      return (
        <>
          <NativeSelect size="sm" aria-label={t("field")} value={c.key} onChange={(e) => onChange({ ...c, key: e.target.value, value: "", op: "eq" })}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            {ops.map((op) => (
              <option key={op} value={op}>
                {t(`op.${op}`)}
              </option>
            ))}
          </NativeSelect>
          {needsValue &&
            (def?.type === "SELECT" || def?.type === "BOOLEAN" ? (
              <NativeSelect size="sm" aria-label={t("value")} value={String(c.value ?? "")} onChange={(e) => onChange({ ...c, value: e.target.value })}>
                <option value="">—</option>
                {(def.type === "BOOLEAN" ? ["yes", "no"] : def.options).map((o) => (
                  <option key={o} value={o}>
                    {def.type === "BOOLEAN" ? t(`bool.${o}`) : o}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                className="h-8 w-40 text-xs"
                aria-label={t("value")}
                type={def?.type === "NUMBER" ? "number" : def?.type === "DATE" ? "date" : "text"}
                value={String(c.value ?? "")}
                onChange={(e) => onChange({ ...c, value: e.target.value })}
              />
            ))}
        </>
      );
    }
    case "attr": {
      const needsValue = c.op === "contains" || c.op === "starts_with";
      return (
        <>
          <NativeSelect size="sm" aria-label={t("field")} value={c.attr} onChange={(e) => onChange({ ...c, attr: e.target.value as typeof c.attr })}>
            {(["name", "phone", "email"] as const).map((a) => (
              <option key={a} value={a}>
                {t(`attr.${a}`)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            {(["contains", "starts_with", "empty", "not_empty"] as const).map((op) => (
              <option key={op} value={op}>
                {t(`op.${op}`)}
              </option>
            ))}
          </NativeSelect>
          {needsValue && <Input className="h-8 w-40 text-xs" aria-label={t("value")} value={c.value ?? ""} onChange={(e) => onChange({ ...c, value: e.target.value })} />}
        </>
      );
    }
    case "opted_in":
    case "opted_out":
      return (
        <NativeSelect size="sm" aria-label={t("value")} value={c.value ? "yes" : "no"} onChange={(e) => onChange({ ...c, value: e.target.value === "yes" })}>
          <option value="yes">{t("bool.yes")}</option>
          <option value="no">{t("bool.no")}</option>
        </NativeSelect>
      );
    case "created":
    case "last_message": {
      const ops = c.type === "created" ? (["within_days", "older_than_days"] as const) : (["within_days", "older_than_days", "never"] as const);
      return (
        <>
          <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value } as Condition)}>
            {ops.map((op) => (
              <option key={op} value={op}>
                {t(`op.${op}`)}
              </option>
            ))}
          </NativeSelect>
          {c.op !== "never" && (
            <span className="flex items-center gap-1 text-xs">
              <Input
                className="h-8 w-20 text-xs"
                type="number"
                min={0}
                max={3650}
                aria-label={t("days")}
                value={c.days ?? 0}
                onChange={(e) => onChange({ ...c, days: Number(e.target.value) } as Condition)}
              />
              {t("days")}
            </span>
          )}
        </>
      );
    }
    case "owner":
      return (
        <>
          <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op, userId: members[0]?.id })}>
            <option value="unassigned">{t("op.unassigned")}</option>
            <option value="is">{t("op.is")}</option>
          </NativeSelect>
          {c.op === "is" && (
            <NativeSelect size="sm" aria-label={t("type.owner")} value={c.userId ?? ""} onChange={(e) => onChange({ ...c, userId: e.target.value })}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </>
      );
    case "deal":
      return (
        <NativeSelect size="sm" aria-label={t("operator")} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
          {(["open", "won", "lost", "none"] as const).map((op) => (
            <option key={op} value={op}>
              {t(`deal.${op}`)}
            </option>
          ))}
        </NativeSelect>
      );
  }
}
