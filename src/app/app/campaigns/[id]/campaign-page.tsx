"use client";

import { useCallback, useMemo, useState } from "react";
import type { FieldDefItem, TagItem } from "@/components/crm/types";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import type { TemplateSpec } from "@/lib/whatsapp/templates";
import type { CampaignItem } from "../types";
import { CampaignEditor } from "./campaign-editor";
import { CampaignReport } from "./campaign-report";

export interface EditorAccount {
  id: string;
  name: string;
  phone: string | null;
  channel: "OFFICIAL" | "QR";
  status: string;
  minDelaySec: number;
  maxDelaySec: number;
}

export interface EditorTemplate {
  id: string;
  accountId: string;
  name: string;
  language: string;
  components: unknown;
  spec: TemplateSpec;
}

export interface Readiness {
  problems: string[];
  audience: number;
}

export interface CampaignContext {
  accounts: EditorAccount[];
  segments: { id: string; name: string }[];
  tags: TagItem[];
  fields: FieldDefItem[];
  templates: EditorTemplate[];
  canned: { id: string; title: string; body: string }[];
  canManage: boolean;
}

/** Draft campaigns open in the editor; launched ones show the live report */
export function CampaignPage({ initial, initialReadiness, ...ctx }: { initial: CampaignItem; initialReadiness: Readiness | null } & CampaignContext) {
  const [campaign, setCampaign] = useState(initial);
  const [readiness, setReadiness] = useState(initialReadiness);

  const reload = useCallback(async () => {
    const res = await apiFetch<{ campaign: CampaignItem; readiness: Readiness | null }>(`/api/campaigns/${initial.id}`);
    if (res.ok && res.data) {
      setCampaign(res.data.campaign);
      setReadiness(res.data.readiness);
    }
  }, [initial.id]);
  const refresh = useMemo(() => debounce(() => void reload(), 800), [reload]);
  useRealtime<{ campaignId: string }>("campaign.updated", (ev) => ev.campaignId === initial.id && campaign.status !== "DRAFT" && refresh());

  return campaign.status === "DRAFT" && ctx.canManage ? (
    <CampaignEditor
      campaign={campaign}
      readiness={readiness}
      ctx={ctx}
      onSaved={(c, r) => {
        setCampaign(c);
        setReadiness(r);
      }}
      onLaunched={reload}
    />
  ) : (
    <CampaignReport campaign={campaign} ctx={ctx} onChanged={reload} />
  );
}
