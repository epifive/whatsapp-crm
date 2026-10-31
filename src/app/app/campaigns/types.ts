export type CampaignStatus = "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED";

export interface CampaignStats {
  total: number;
  pending: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  replied: number;
}

export interface ParamSource {
  source: string;
  value: string;
}

export interface Audience {
  type: "all" | "segment" | "tags";
  segmentId?: string | null;
  tagIds: string[];
  consent: "any" | "opted_in";
}

export interface CampaignMedia {
  storageKey: string;
  mimeType: string;
  fileName: string;
  size?: number;
}

export interface CampaignItem {
  id: string;
  name: string;
  status: CampaignStatus;
  statusMessage: string | null;
  account: { id: string; name: string; channel: "OFFICIAL" | "QR"; phone: string | null; status: string; minDelaySec: number; maxDelaySec: number };
  audience: Audience;
  segment: { id: string; name: string } | null;
  template: { id: string; name: string; language: string; status: string } | null;
  templateParams: { header: ParamSource[]; body: ParamSource[]; buttons: Record<string, ParamSource> } | null;
  body: string | null;
  media: CampaignMedia | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  stats: CampaignStats | null;
}

export const STATUS_STYLE: Record<CampaignStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SCHEDULED: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  RUNNING: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  PAUSED: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  COMPLETED: "bg-primary/10 text-primary",
  CANCELLED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function pct(n: number, of: number): string {
  return of ? `${Math.round((n / of) * 100)}%` : "0%";
}
