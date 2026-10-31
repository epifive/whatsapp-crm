import { db } from "./db";

/**
 * Realtime events to browsers. Any process (web app or worker) publishes through Postgres
 * NOTIFY; the web server LISTENs and forwards to Socket.IO rooms. No Redis needed.
 *
 * Payloads must stay small (Postgres limit ~8 KB): send ids, let the client refetch details.
 */
export const REALTIME_CHANNEL = "wacrm_realtime";

export type RealtimeRoom = `org:${string}` | `user:${string}`;

export async function publish(room: RealtimeRoom, event: string, data: Record<string, unknown> = {}): Promise<void> {
  const payload = JSON.stringify({ room, event, data });
  if (Buffer.byteLength(payload) > 7500) throw new Error(`Realtime payload too large for ${event}`);
  await db.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`;
}
