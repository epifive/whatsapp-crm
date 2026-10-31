import { ApiError } from "@/lib/api";
import { contactDisplayName } from "@/lib/inbox";
import { safeRequest } from "@/lib/safe-http";
import { MAX_UPLOAD_BYTES, saveMedia } from "@/lib/storage";
import type { OrgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";
import type { Contact, Prisma } from "@/generated/prisma/client";

/** The number to send from: the one asked for, else the workspace's first connected number */
export async function pickAccount(tdb: OrgDb, accountId?: string | null) {
  const account = accountId
    ? await tdb.whatsAppAccount.findUnique({ where: { id: accountId } })
    : await tdb.whatsAppAccount.findFirst({ where: { status: "CONNECTED" }, orderBy: { createdAt: "asc" } });
  if (!account) throw new ApiError(accountId ? 404 : 400, accountId ? "WhatsApp number not found." : "No connected WhatsApp number.", "no_account");
  return account;
}

export function apiPhone(raw: unknown): string {
  const phone = normalizePhone(typeof raw === "string" ? raw : "");
  if (!isValidPhone(phone)) throw new ApiError(400, "`to` / `phone` must be a number with country code, e.g. +919000012345.", "invalid_phone");
  return phone;
}

/** Contact + conversation for an API send (created when new) */
export async function chatFor(tdb: OrgDb, orgId: string, accountId: string, phone: string) {
  const contact = await tdb.contact.upsert({ where: { orgId_phone: { orgId, phone } }, create: { orgId, phone, source: "api" }, update: {} });
  const conversation = await tdb.conversation.upsert({
    where: { accountId_contactId: { accountId, contactId: contact.id } },
    create: { orgId, accountId, contactId: contact.id },
    update: {},
  });
  return { contact, conversation };
}

const MEDIA_TYPES: Record<string, "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT"> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "audio/mpeg": "AUDIO",
  "audio/ogg": "AUDIO",
  "audio/mp4": "AUDIO",
  "application/pdf": "DOCUMENT",
};

/** Downloads a media_url (public https only, 16 MB) into workspace storage */
export async function fetchMedia(orgId: string, url: string) {
  if (!/^https:\/\//.test(url)) throw new ApiError(400, "media_url must be an https:// link.", "invalid_media");
  let res;
  try {
    res = await safeRequest(url, { timeoutMs: 30_000, maxBytes: MAX_UPLOAD_BYTES });
  } catch (err) {
    throw new ApiError(400, `Could not download media_url: ${(err as Error).message}`, "invalid_media");
  }
  if (res.status !== 200) throw new ApiError(400, `Could not download media_url (HTTP ${res.status}).`, "invalid_media");
  const mimeType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  const type = MEDIA_TYPES[mimeType];
  if (!type) throw new ApiError(400, `Unsupported media type "${mimeType || "unknown"}". Use JPG/PNG/WebP, MP4, MP3/OGG or PDF.`, "invalid_media");
  const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const saved = await saveMedia(orgId, res.body, mimeType, fileName);
  return { type, media: { storageKey: saved.storageKey, mimeType, fileName, size: saved.size } };
}

export function contactJson(c: Contact & { tags?: { tag: { name: string } }[] }) {
  return {
    id: c.id,
    phone: c.phone,
    name: contactDisplayName(c),
    email: c.email,
    fields: c.fields,
    tags: c.tags?.map((t) => t.tag.name) ?? [],
    opted_in_at: c.optedInAt,
    opted_out: c.optedOut,
    created_at: c.createdAt,
  };
}

export const contactApiInclude = { tags: { select: { tag: { select: { name: true } } } } } satisfies Prisma.ContactInclude;
