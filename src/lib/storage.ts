import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE_ROOT } from "./paths";

/**
 * Media storage on local disk under storage/media. Keys look like
 * "<orgId>/<yyyy>/<mm>/<random>.<ext>" and are never built from user input directly.
 */
const ROOT = path.join(STORAGE_ROOT, "media");
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

export function extensionFor(mimeType: string | undefined, fileName?: string): string {
  const fromMime = mimeType ? EXT_BY_MIME[mimeType.split(";")[0].trim().toLowerCase()] : undefined;
  if (fromMime) return fromMime;
  const fromName = fileName?.split(".").pop()?.toLowerCase();
  return fromName && /^[a-z0-9]{1,8}$/.test(fromName) ? fromName : "bin";
}

function resolveKey(key: string): string {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const full = path.join(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key");
  return full;
}

export async function saveMedia(orgId: string, data: Buffer, mimeType: string | undefined, fileName?: string): Promise<{ storageKey: string; size: number }> {
  const now = new Date();
  const key = `${orgId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${crypto.randomBytes(12).toString("hex")}.${extensionFor(mimeType, fileName)}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return { storageKey: key, size: data.length };
}

export async function readMedia(storageKey: string): Promise<Buffer> {
  return fs.readFile(resolveKey(storageKey));
}

export async function deleteMedia(storageKey: string): Promise<void> {
  await fs.rm(resolveKey(storageKey), { force: true });
}

/** WhatsApp message type for an uploaded file */
export function messageTypeForMime(mimeType: string): "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" {
  const m = mimeType.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp"].includes(m)) return "IMAGE";
  if (m === "video/mp4" || m === "video/3gpp") return "VIDEO";
  if (m.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}
