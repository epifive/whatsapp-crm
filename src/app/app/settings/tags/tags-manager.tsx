"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";

interface TagRow {
  id: string;
  name: string;
  color: string;
  contacts: number;
}

export function TagsManager({ initial, canManage }: { initial: TagRow[]; canManage: boolean }) {
  const t = useTranslations("tagsSettings");
  const [tags, setTags] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function reload() {
    const res = await apiFetch<{ tags: TagRow[] }>("/api/tags");
    if (res.ok && res.data) setTags(res.data.tags);
  }

  async function save(e: React.FormEvent<HTMLFormElement>, tag: TagRow) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await apiFetch(`/api/tags/${tag.id}`, { method: "PATCH", body: { name: f.get("name"), color: f.get("color") } });
    if (!res.ok) return toast.error(res.error);
    setEditingId(null);
    await reload();
  }

  async function remove(tag: TagRow) {
    if (!confirm(t("confirmDelete", { name: tag.name, count: tag.contacts }))) return;
    const res = await apiFetch(`/api/tags/${tag.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    await reload();
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <Card>
        <CardContent className="divide-y">
          {tags.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
          {tags.map((tag) =>
            editingId === tag.id ? (
              <form key={tag.id} onSubmit={(e) => save(e, tag)} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                <input type="color" name="color" defaultValue={tag.color} aria-label={t("color")} className="h-8 w-9 cursor-pointer rounded border bg-transparent" />
                <Input name="name" defaultValue={tag.name} required maxLength={30} aria-label={t("name")} className="h-8 max-w-60 flex-1" autoFocus />
                <Button type="submit" size="icon-sm" aria-label={t("save")}>
                  <Check />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={() => setEditingId(null)}>
                  <X />
                </Button>
              </form>
            ) : (
              <div key={tag.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                  {tag.name}
                </span>
                <Link href={`/app/contacts?tag=${tag.id}`} className="flex-1 text-sm text-muted-foreground hover:underline">
                  {t("contacts", { count: tag.contacts })}
                </Link>
                {canManage && (
                  <div className="flex">
                    <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditingId(tag.id)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => remove(tag)}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            ),
          )}
        </CardContent>
      </Card>
    </div>
  );
}
