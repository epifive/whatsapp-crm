import { db } from "./db";

const KEY = "worker.heartbeat";
// The worker beats every minute; three missed beats means it's down
const STALE_AFTER_MS = 3 * 60 * 1000;

export async function recordWorkerHeartbeat(): Promise<void> {
  const value = { at: new Date().toISOString(), pid: process.pid };
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

export async function getWorkerStatus(): Promise<{ online: boolean; lastSeen: Date | null }> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  const at = (row?.value as { at?: string } | null)?.at;
  const lastSeen = at ? new Date(at) : null;
  return { online: !!lastSeen && Date.now() - lastSeen.getTime() < STALE_AFTER_MS, lastSeen };
}
