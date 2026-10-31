// Shapes of the CRM API responses as the browser sees them (dates arrive as ISO strings)

export type Role = "OWNER" | "ADMIN" | "AGENT";
export type FieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" | "EMAIL" | "URL";

export interface Member {
  id: string;
  name: string;
}

export interface TagItem {
  id: string;
  name: string;
  color: string;
}

export interface FieldDefItem {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

export interface ContactItem {
  id: string;
  phone: string;
  name: string;
  savedName: string | null;
  waName: string | null;
  email: string | null;
  optedOut: boolean;
  optedOutAt: string | null;
  optedInAt: string | null;
  optInSource: string | null;
  source: string | null;
  owner: Member | null;
  fields: Record<string, string | number | boolean>;
  tags: TagItem[];
  createdAt: string;
}

export interface StageItem {
  id: string;
  name: string;
  color: string;
  kind: "OPEN" | "WON" | "LOST";
  probability: number;
}

export interface PipelineItem {
  id: string;
  name: string;
  deals?: number;
  stages: StageItem[];
}

export interface DealItem {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: "OPEN" | "WON" | "LOST";
  pipelineId: string;
  stageId: string;
  stage: { id: string; name: string; color: string; kind: StageItem["kind"] };
  position: number;
  expectedCloseAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
  contact: { id: string; phone: string; name: string } | null;
  owner: Member | null;
  openTasks: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  completedAt: string | null;
  assignee: Member | null;
  contact: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
  createdAt: string;
}

export type TimelineEntry =
  | { kind: "activity"; id: string; at: string; type: string; actor: string | null; data: Record<string, unknown> }
  | { kind: "note"; id: string; at: string; body: string; author: string | null; dealId: string | null }
  | {
      kind: "message";
      id: string;
      at: string;
      direction: "INBOUND" | "OUTBOUND";
      type: string;
      body: string | null;
      status: string;
      conversationId: string;
      accountName: string;
    };
