"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";

interface Item {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

export function CannedManager({ initial, canManage }: { initial: Item[]; canManage: boolean }) {
  const t = useTranslations("canned");
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const res = await apiFetch<{ items: Item[] }>("/api/canned-responses");
    if (res.ok && res.data) setItems(res.data.items);
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { shortcut: f.get("shortcut"), title: f.get("title"), body: f.get("body") };
    const res =
      editing === "new" ? await apiFetch("/api/canned-responses", { body }) : await apiFetch(`/api/canned-responses/${(editing as Item).id}`, { method: "PATCH", body });
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    setEditing(null);
    setError(null);
    await reload();
  }

  async function remove(item: Item) {
    if (!confirm(t("confirmDelete", { shortcut: item.shortcut }))) return;
    const res = await apiFetch(`/api/canned-responses/${item.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    await reload();
  }

  const current = editing && editing !== "new" ? editing : null;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && !editing && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("add")}
          </Button>
        )}
      </div>

      {editing && (
        <Card>
          <form onSubmit={save} key={current?.id ?? "new"}>
            <CardHeader>
              <CardTitle>{current ? t("edit") : t("add")}</CardTitle>
              <CardDescription>{t("formHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormMessage type="error">{error}</FormMessage>
              <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                <Field id="shortcut" label={t("shortcut")} defaultValue={current?.shortcut} placeholder="pricing" required maxLength={30} />
                <Field id="title" label={t("titleLabel")} defaultValue={current?.title} placeholder={t("titlePlaceholder")} required maxLength={80} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="body">{t("message")}</Label>
                <Textarea id="body" name="body" rows={5} defaultValue={current?.body} required maxLength={4096} />
              </div>
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
          {items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/{item.shortcut}</code> {item.title}
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={t("edit")} onClick={() => setEditing(item)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("delete")} onClick={() => remove(item)}>
                    <Trash2 className="size-4 text-muted-foreground" />
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
