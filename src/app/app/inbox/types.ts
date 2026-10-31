export type ConversationStatus = "OPEN" | "PENDING" | "CLOSED";
export type MessageStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ConversationItem {
  id: string;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  contact: { id: string; phone: string; name: string; savedName: string | null; waName: string | null; optedOut: boolean; tags: Tag[] };
  account: { id: string; name: string; channel: "OFFICIAL" | "QR"; phone: string | null; status: string };
  assignee: { id: string; name: string } | null;
  window: { open: boolean; expiresAt: string | null } | null;
}

export interface MessageItem {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  body: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  sentBy: { name: string } | null;
  replyToId: string | null;
  payload: Record<string, unknown> | null;
  media: { url: string | null; pending: boolean; error: string | null; mimeType: string | null; fileName: string | null; size: number | null } | null;
}

export interface NoteItem {
  id: string;
  body: string;
  createdAt: string;
  author: string | null;
}

export interface InboxContext {
  me: { id: string; name: string };
  members: { id: string; name: string }[];
  accounts: { id: string; name: string; channel: "OFFICIAL" | "QR"; phone: string | null; status: string }[];
  canned: { id: string; shortcut: string; title: string; body: string }[];
}

export interface TemplateItem {
  id: string;
  accountId: string;
  name: string;
  language: string;
  category: string;
  headerVariables: number;
  bodyVariables: number;
  mediaHeader: boolean;
  preview: string;
}
