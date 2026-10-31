import { db } from "@/lib/db";

/**
 * Commands from the web app to the worker that owns the QR (Baileys) connections, over Postgres
 * NOTIFY so they act immediately. The worker also reconciles on start-up, so a command sent
 * while it was down isn't lost: account status in the database is the source of truth.
 */
export const WORKER_CHANNEL = "wacrm_worker";

export type WorkerCommand = { action: "qr.start" | "qr.stop" | "qr.logout"; accountId: string };

export async function sendWorkerCommand(cmd: WorkerCommand): Promise<void> {
  await db.$executeRaw`SELECT pg_notify(${WORKER_CHANNEL}, ${JSON.stringify(cmd)})`;
}
