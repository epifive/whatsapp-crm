import type { Message, Prisma } from "@/generated/prisma/client";
import { isWindowOpen, windowExpiresAt } from "@/lib/whatsapp/window";

export const conversationInclude = {
  contact: { select: { id: true, phone: true, name: true, waName: true, optedOut: true, tags: { select: { tag: { select: { id: true, name: true, color: true } } } } } },
  account: { select: { id: true, name: true, channel: true, phone: true, status: true } },
  assignee: { select: { id: true, name: true } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

export function contactDisplayName(c: { name: string | null; waName: string | null; phone: string }) {
  return c.name || c.waName || `+${c.phone}`;
}

export function conversationView(c: ConversationRow) {
  const official = c.account.channel === "OFFICIAL";
  return {
    id: c.id,
    status: c.status,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    contact: {
      id: c.contact.id,
      phone: c.contact.phone,
      name: contactDisplayName(c.contact),
      savedName: c.contact.name,
      waName: c.contact.waName,
      optedOut: c.contact.optedOut,
      tags: c.contact.tags.map((t) => t.tag),
    },
    account: c.account,
    assignee: c.assignee,
    // Cloud API only allows free-form replies within 24h of the customer's last message
    window: official ? { open: isWindowOpen(c.lastInboundAt), expiresAt: windowExpiresAt(c.lastInboundAt) } : null,
  };
}

interface MediaInfo {
  storageKey?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
  providerMediaId?: string;
  error?: string;
}

export function messageView(m: Message & { sentBy?: { name: string } | null }) {
  const media = m.media as MediaInfo | null;
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt,
    sentBy: m.sentBy ? { name: m.sentBy.name } : null,
    replyToId: m.replyToId,
    payload: m.payload,
    media: media
      ? {
          url: media.storageKey ? `/api/media/${m.id}` : null,
          pending: !media.storageKey && !media.error,
          error: media.error ?? null,
          mimeType: media.mimeType ?? null,
          fileName: media.fileName ?? null,
          size: media.size ?? null,
        }
      : null,
  };
}
