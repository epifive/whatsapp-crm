"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import { ContactPicker, type PickedContact } from "./contact-picker";
import type { DealItem, Member, PipelineItem } from "./types";

/** Create (deal = null) or edit a deal */
export function DealDialog({
  open,
  onOpenChange,
  deal,
  pipelines,
  members,
  meId,
  currency,
  defaultPipelineId,
  defaultStageId,
  contact,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: DealItem | null;
  pipelines: PipelineItem[];
  members: Member[];
  meId: string;
  currency: string;
  defaultPipelineId?: string;
  defaultStageId?: string;
  contact?: PickedContact | null;
  onSaved: (deal: DealItem) => void;
}) {
  const t = useTranslations("crm");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pipelineId, setPipelineId] = useState(deal?.pipelineId ?? defaultPipelineId ?? pipelines[0]?.id ?? "");
  const [picked, setPicked] = useState<PickedContact | null>(deal?.contact ?? contact ?? null);
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const lockedContact = contact !== undefined && !deal;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const closeDate = f.get("expectedCloseAt");
    const body = {
      title: f.get("title"),
      value: Number(f.get("value") || 0),
      pipelineId,
      stageId: f.get("stageId"),
      contactId: picked?.id ?? null,
      ownerId: f.get("ownerId") || null,
      expectedCloseAt: closeDate ? new Date(`${closeDate}T12:00:00`).toISOString() : null,
      ...(deal ? { lostReason: f.get("lostReason") || null } : {}),
    };
    setPending(true);
    const res = deal
      ? await apiFetch<{ deal: DealItem }>(`/api/deals/${deal.id}`, { method: "PATCH", body })
      : await apiFetch<{ deal: DealItem }>("/api/deals", { body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(deal ? t("dealSaved") : t("dealCreated"));
    setError(null);
    onOpenChange(false);
    onSaved(res.data!.deal);
  }

  const lost = deal?.status === "LOST";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{deal ? t("editDeal") : t("newDeal")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="title" label={t("dealTitle")} defaultValue={deal?.title} required maxLength={120} placeholder={t("dealTitlePlaceholder")} autoFocus />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="value" label={t("dealValue", { currency: deal?.currency ?? currency })} type="number" min={0} step="0.01" defaultValue={deal ? String(deal.value) : ""} />
            <Field id="expectedCloseAt" label={t("expectedClose")} type="date" defaultValue={deal?.expectedCloseAt?.slice(0, 10) ?? ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pipelineId">{t("pipeline")}</Label>
              <NativeSelect id="pipelineId" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stageId">{t("stage")}</Label>
              <NativeSelect id="stageId" name="stageId" key={pipelineId} defaultValue={deal?.pipelineId === pipelineId ? deal.stageId : (defaultStageId ?? stages[0]?.id)}>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("contact")}</Label>
            <ContactPicker value={picked} onChange={setPicked} disabled={lockedContact} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ownerId">{t("owner")}</Label>
            <NativeSelect id="ownerId" name="ownerId" defaultValue={deal ? (deal.owner?.id ?? "") : meId}>
              <option value="">{t("unassigned")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === meId ? t("me", { name: m.name }) : m.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          {lost && <Field id="lostReason" label={t("lostReason")} defaultValue={deal?.lostReason ?? ""} maxLength={200} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !stages.length}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
