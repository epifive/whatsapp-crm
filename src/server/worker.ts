/**
 * Background worker: job queue (pg-boss on Postgres), scheduled tasks and the WhatsApp QR
 * connections. Run alongside the web server:
 *   npm run worker
 */
import "dotenv/config";
import dotenv from "dotenv";
import { Client } from "pg";
import { isInstalled } from "@/lib/install-state";
import { PgBoss } from "pg-boss";
import { recordWorkerHeartbeat } from "@/lib/worker-status";
import { WORKER_CHANNEL, type WorkerCommand } from "@/lib/whatsapp/worker-commands";
import { NOTIFY_QUEUES, QUEUE_POLICIES, QUEUES } from "./queue";
import { QrManager } from "./qr/manager";
import { processOutbound } from "./jobs/send-message";
import { processMediaDownload, processOfficialInbound } from "./jobs/official-inbound";
import { processContactImport } from "./jobs/contact-import";
import { processTaskReminders } from "./jobs/task-reminders";
import { campaignScheduler, dispatchCampaign, startCampaign } from "./jobs/campaigns";
import { automationHousekeeping } from "./jobs/housekeeping";
import { billingLifecycle } from "./jobs/billing";
import { handleInboundForFlows, resumeAfterDelay, startFlowJob } from "@/lib/flows/engine";
import { deliverWebhookJob } from "@/lib/webhooks";
import { demoResetHours, isDemo } from "@/lib/demo/mode";
import { resetDemo } from "@/lib/demo/reset";

// Arbitrary constant: only the worker holding this advisory lock runs QR sessions
const QR_LOCK_KEY = 74_712_001;

/** pg-boss retries failed jobs silently; log the error so operators can see why */
async function logFailure<T>(queue: string, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(`[worker] ${queue} job failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

async function main() {
  // A fresh install: wait for the web installer, then load the .env it wrote
  if (!isInstalled()) {
    console.log("> Waiting for the web installer (open /install in your browser)…");
    while (!isInstalled()) await new Promise((r) => setTimeout(r, 5000));
    dotenv.config({ quiet: true });
  }
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, useListenNotify: true });
  boss.on("error", (err) => console.error("[worker] pg-boss error:", err));
  await boss.start();
  // Jobs this worker enqueues (e.g. media downloads) reuse the same instance
  globalThis.__wacrmBoss = Promise.resolve(boss);

  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, { notify: NOTIFY_QUEUES.includes(name as (typeof NOTIFY_QUEUES)[number]), ...(QUEUE_POLICIES[name] ? { policy: QUEUE_POLICIES[name] } : {}) });
  }

  // QR sessions: one owner only, enforced with a session-level Postgres advisory lock
  const lockClient = new Client({ connectionString: process.env.DATABASE_URL });
  await lockClient.connect();
  const { rows } = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [QR_LOCK_KEY]);
  const qr = rows[0]?.locked ? new QrManager() : null;
  if (qr) {
    await qr.restoreAll();
    // Commands from the web app (connect / disconnect / logout a QR number)
    await lockClient.query(`LISTEN ${WORKER_CHANNEL}`);
    lockClient.on("notification", (msg) => {
      if (msg.channel !== WORKER_CHANNEL || !msg.payload) return;
      let cmd: WorkerCommand;
      try {
        cmd = JSON.parse(msg.payload);
      } catch {
        return;
      }
      const run =
        cmd.action === "qr.start" ? qr.start(cmd.accountId) : cmd.action === "qr.stop" ? qr.stop(cmd.accountId) : qr.stop(cmd.accountId, { logout: true });
      run.catch((err) => console.error(`[worker] ${cmd.action} ${cmd.accountId} failed:`, err));
    });
  } else {
    console.warn("> Another worker already runs the WhatsApp QR sessions; this one only processes jobs.");
  }

  await boss.work<{ messageId: string; profile?: "conversation" | "bulk" }>(
    QUEUES.outboundSend,
    // Several numbers send in parallel; each number is still serialised by its pacing queue
    { batchSize: 1, localConcurrency: 10, includeMetadata: true },
    async ([job]) => logFailure(QUEUES.outboundSend, processOutbound(job.data, job.retryCount, qr)),
  );
  await boss.work<{ accountId: string; payload: unknown }>(QUEUES.officialInbound, { localConcurrency: 4 }, async ([job]) =>
    logFailure(QUEUES.officialInbound, processOfficialInbound(job.data)),
  );
  await boss.work<{ messageId: string }>(QUEUES.mediaDownload, { localConcurrency: 4 }, async ([job]) =>
    logFailure(QUEUES.mediaDownload, processMediaDownload(job.data)),
  );

  await boss.work<{ importId: string }>(QUEUES.contactImport, { localConcurrency: 2 }, async ([job]) =>
    logFailure(QUEUES.contactImport, processContactImport(job.data)),
  );
  await boss.work(QUEUES.taskReminders, async () => logFailure(QUEUES.taskReminders, processTaskReminders()));
  await boss.work<{ campaignId: string }>(QUEUES.campaignStart, { localConcurrency: 2 }, async ([job]) => logFailure(QUEUES.campaignStart, startCampaign(job.data)));
  // Dispatch re-schedules itself a few seconds ahead; NOTIFY doesn't fire for deferred jobs, so
  // poll this queue every second instead of the 30-second backstop
  await boss.work<{ campaignId: string }>(QUEUES.campaignDispatch, { localConcurrency: 10, pollingIntervalSeconds: 1, notifyPollingIntervalSeconds: 1 }, async ([job]) =>
    logFailure(QUEUES.campaignDispatch, dispatchCampaign(job.data)),
  );
  await boss.work(QUEUES.campaignScheduler, async () => logFailure(QUEUES.campaignScheduler, campaignScheduler()));

  // Chatbot flows. flow.inbound handlers never throw (FIFO per conversation)
  await boss.work<{ messageId: string }>(QUEUES.flowInbound, { localConcurrency: 10 }, async ([job]) => handleInboundForFlows(job.data));
  await boss.work<{ sessionId: string; nodeId: string }>(QUEUES.flowResume, { localConcurrency: 5, pollingIntervalSeconds: 5, notifyPollingIntervalSeconds: 5 }, async ([job]) =>
    logFailure(QUEUES.flowResume, resumeAfterDelay(job.data)),
  );
  await boss.work<{ flowId: string; conversationId: string; variables?: Record<string, string> }>(QUEUES.flowStart, { localConcurrency: 5 }, async ([job]) =>
    logFailure(QUEUES.flowStart, startFlowJob(job.data)),
  );
  await boss.work<{ endpointId: string; event: string; data: Record<string, unknown>; deliveryId: string }>(
    QUEUES.webhookDeliver,
    { localConcurrency: 10, includeMetadata: true },
    async ([job]) => deliverWebhookJob(job.data, job.retryCount),
  );
  await boss.work(QUEUES.automationHousekeeping, async () => logFailure(QUEUES.automationHousekeeping, automationHousekeeping()));
  await boss.schedule(QUEUES.automationHousekeeping, "*/5 * * * *");
  await boss.schedule(QUEUES.campaignScheduler, "* * * * *");
  await boss.schedule(QUEUES.taskReminders, "* * * * *");
  await boss.work(QUEUES.billingLifecycle, async () => logFailure(QUEUES.billingLifecycle, billingLifecycle()));
  await boss.schedule(QUEUES.billingLifecycle, "*/10 * * * *");

  // Live demo: rebuild the demo data every few hours (set it up once with npm run demo:reset)
  if (isDemo()) {
    await boss.work(QUEUES.demoReset, async () => {
      if (isDemo()) await logFailure(QUEUES.demoReset, resetDemo());
    });
    await boss.schedule(QUEUES.demoReset, `0 */${demoResetHours()} * * *`);
  } else {
    await boss.unschedule(QUEUES.demoReset);
  }

  await boss.work(QUEUES.heartbeat, async () => recordWorkerHeartbeat());
  // Every minute, so the admin panel can show whether the worker is running
  await boss.schedule(QUEUES.heartbeat, "* * * * *");
  await recordWorkerHeartbeat();

  console.log(`> Worker started${qr ? " (WhatsApp QR sessions: this worker)" : ""}`);

  const shutdown = async (signal: string) => {
    console.log(`> Worker stopping (${signal})`);
    await qr?.stopAll();
    await boss.stop({ graceful: true, timeout: 20_000 });
    await lockClient.end().catch(() => null);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
