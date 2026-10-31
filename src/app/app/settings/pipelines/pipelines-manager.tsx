"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { PipelineItem, StageItem } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";

type DraftStage = Omit<StageItem, "id"> & { id?: string; key: string };

const NEW_STAGES: Omit<DraftStage, "key">[] = [
  { name: "New", color: "#64748b", kind: "OPEN", probability: 10 },
  { name: "In progress", color: "#2563eb", kind: "OPEN", probability: 50 },
  { name: "Won", color: "#16a34a", kind: "WON", probability: 100 },
  { name: "Lost", color: "#dc2626", kind: "LOST", probability: 0 },
];

let keySeq = 0;
const withKey = (s: Omit<DraftStage, "key">): DraftStage => ({ ...s, key: `k${++keySeq}` });

export function PipelinesManager({ initial, canManage }: { initial: PipelineItem[]; canManage: boolean }) {
  const t = useTranslations("pipelines");
  const [pipelines, setPipelines] = useState(initial);
  const [editing, setEditing] = useState<PipelineItem | "new" | null>(null);

  async function reload() {
    const res = await apiFetch<{ pipelines: PipelineItem[] }>("/api/pipelines");
    if (res.ok && res.data) setPipelines(res.data.pipelines);
  }

  async function remove(p: PipelineItem) {
    if (!confirm(t("confirmDelete", { name: p.name, deals: p.deals ?? 0 }))) return;
    const res = await apiFetch(`/api/pipelines/${p.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    await reload();
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && !editing && (
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {t("add")}
          </Button>
        )}
      </div>

      {editing && (
        <PipelineEditor
          key={editing === "new" ? "new" : editing.id}
          pipeline={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      {pipelines.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1 basis-40">
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{t("dealCount", { count: p.deals ?? 0 })}</CardDescription>
              </div>
              {canManage && (
                <div className="flex">
                  <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing(p)}>
                    <Pencil />
                  </Button>
                  {pipelines.length > 1 && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => remove(p)}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-wrap gap-2">
              {p.stages.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
                  <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                  {s.kind !== "OPEN" ? <span className="text-muted-foreground">· {t(`kinds.${s.kind}`)}</span> : <span className="text-muted-foreground">· {s.probability}%</span>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PipelineEditor({ pipeline, onDone }: { pipeline: PipelineItem | null; onDone: () => void }) {
  const t = useTranslations("pipelines");
  const [stages, setStages] = useState<DraftStage[]>(() => (pipeline?.stages ?? NEW_STAGES).map(withKey));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (i: number, patch: Partial<DraftStage>) => setStages((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setStages((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + dir, 0, item!);
      return next;
    });

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    // `key` only exists for React; the API gets the stage fields
    const body = { name, stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, kind: s.kind, probability: s.probability })) };
    setPending(true);
    const res = pipeline ? await apiFetch(`/api/pipelines/${pipeline.id}`, { method: "PATCH", body }) : await apiFetch("/api/pipelines", { body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    onDone();
  }

  return (
    <Card>
      <form onSubmit={save}>
        <CardHeader>
          <CardTitle>{pipeline ? t("edit") : t("add")}</CardTitle>
          <CardDescription>{t("editorHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormMessage type="error">{error}</FormMessage>
          <Field id="name" label={t("name")} defaultValue={pipeline?.name} required maxLength={60} className="max-w-sm" />
          <ol className="grid gap-2">
            {stages.map((s, i) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => update(i, { color: e.target.value })}
                  aria-label={t("color")}
                  className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent"
                />
                <Input value={s.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={t("stageName")} required maxLength={40} className="h-8 min-w-32 flex-1" />
                <NativeSelect size="sm" aria-label={t("kind")} value={s.kind} onChange={(e) => update(i, { kind: e.target.value as StageItem["kind"] })}>
                  {(["OPEN", "WON", "LOST"] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
                {s.kind === "OPEN" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={s.probability}
                      onChange={(e) => update(i, { probability: Math.min(100, Math.max(0, Number(e.target.value))) })}
                      aria-label={t("probability")}
                      className="h-8 w-16 text-xs"
                    />
                    %
                  </span>
                )}
                <div className="ms-auto flex">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveDown")} disabled={i === stages.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("removeStage")}
                    disabled={stages.length <= 1}
                    onClick={() => setStages((list) => list.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={stages.length >= 20}
            onClick={() => {
              // New open stages go before the Won/Lost ones
              const at = stages.findIndex((s) => s.kind !== "OPEN");
              const next = [...stages];
              next.splice(at < 0 ? next.length : at, 0, withKey({ name: "", color: "#0891b2", kind: "OPEN", probability: 50 }));
              setStages(next);
            }}
          >
            <Plus />
            {t("addStage")}
          </Button>
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
