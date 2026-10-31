"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefItem, FieldType } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";

const TYPES: FieldType[] = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "EMAIL", "URL"];

export function FieldsManager({ initial, canManage }: { initial: FieldDefItem[]; canManage: boolean }) {
  const t = useTranslations("fields");
  const [fields, setFields] = useState(initial);
  const [editing, setEditing] = useState<FieldDefItem | "new" | null>(null);
  const [type, setType] = useState<FieldType>("TEXT");
  const [error, setError] = useState<string | null>(null);
  const current = editing && editing !== "new" ? editing : null;
  const shownType = current?.type ?? type;

  async function reload() {
    const res = await apiFetch<{ fields: FieldDefItem[] }>("/api/custom-fields");
    if (res.ok && res.data) setFields(res.data.fields);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const options = String(f.get("options") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const res =
      editing === "new"
        ? await apiFetch("/api/custom-fields", { body: { label: f.get("label"), key: f.get("key") || undefined, type, options } })
        : await apiFetch(`/api/custom-fields/${(editing as FieldDefItem).id}`, { method: "PATCH", body: { label: f.get("label"), ...(current?.type === "SELECT" ? { options } : {}) } });
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    setEditing(null);
    setError(null);
    await reload();
  }

  async function remove(field: FieldDefItem) {
    if (!confirm(t("confirmDelete", { label: field.label }))) return;
    const res = await apiFetch(`/api/custom-fields/${field.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    await reload();
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...fields];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item!);
    setFields(next);
    await Promise.all(next.map((f, position) => apiFetch(`/api/custom-fields/${f.id}`, { method: "PATCH", body: { position } })));
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && !editing && (
          <Button onClick={() => (setEditing("new"), setType("TEXT"))}>
            <Plus />
            {t("add")}
          </Button>
        )}
      </div>

      {editing && (
        <Card>
          <form onSubmit={save} key={current?.id ?? "new"}>
            <CardHeader>
              <CardTitle>{current ? t("edit") : t("add")}</CardTitle>
              {current && <CardDescription>{t("editHelp")}</CardDescription>}
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormMessage type="error">{error}</FormMessage>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="label" label={t("label")} defaultValue={current?.label} required maxLength={60} placeholder={t("labelPlaceholder")} />
                <div className="grid gap-1.5">
                  <Label htmlFor="type">{t("type")}</Label>
                  <NativeSelect id="type" value={shownType} onChange={(e) => setType(e.target.value as FieldType)} disabled={!!current}>
                    {TYPES.map((ty) => (
                      <option key={ty} value={ty}>
                        {t(`types.${ty}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {!current && <Field id="key" label={t("key")} hint={t("keyHint")} pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} placeholder="auto" />}
              </div>
              {shownType === "SELECT" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="options">{t("choices")}</Label>
                  <Textarea id="options" name="options" rows={4} defaultValue={current?.options.join("\n")} placeholder={t("choicesPlaceholder")} required />
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit">{t("save")}</Button>
                <Button type="button" variant="ghost" onClick={() => (setEditing(null), setError(null))}>
                  {t("cancel")}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      )}

      <Card>
        <CardContent className="divide-y">
          {fields.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
          {fields.map((field, i) => (
            <div key={field.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-40">
                <div className="font-medium">{field.label}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`types.${field.type}`)} · <code>{`{{${field.key}}}`}</code>
                  {field.type === "SELECT" && ` · ${field.options.join(", ")}`}
                </div>
              </div>
              {canManage && (
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" aria-label={t("moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t("moveDown")} disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(field)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => remove(field)}>
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
