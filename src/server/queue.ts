import { PgBoss } from "pg-boss";

/** Job queues. All are created by the worker; the web app only sends to them. */
export const QUEUES = {
  heartbeat: "system.heartbeat",
  outboundSend: "message.send", // { messageId }
  officialInbound: "official.inbound", // { accountId, payload }
  mediaDownload: "media.download", // { messageId }
  contactImport: "contacts.import", // { importId }
  taskReminders: "tasks.reminders", // cron, every minute
  campaignStart: "campaign.start", // { campaignId }
  campaignDispatch: "campaign.dispatch", // { campaignId } one queued/active job per campaign
  campaignScheduler: "campaign.scheduler", // cron, every minute
  flowInbound: "flow.inbound", // { messageId } FIFO per conversation
  flowResume: "flow.resume", // { sessionId, nodeId } after a delay step
  flowStart: "flow.start", // { flowId, conversationId, variables } manual / API start
  automationHousekeeping: "automation.housekeeping", // cron: expire sessions, prune webhook logs
  webhookDeliver: "webhook.deliver", // { endpointId, event, data, deliveryId }
  billingLifecycle: "billing.lifecycle", // cron: trial/period ends, reminders, abandoned checkouts
  demoReset: "demo.reset", // cron, live demo only (DEMO_MODE=true)
} as const;

// Queues whose jobs must start immediately (chat replies, incoming messages)
export const NOTIFY_QUEUES = [
  QUEUES.outboundSend,
  QUEUES.officialInbound,
  QUEUES.mediaDownload,
  QUEUES.contactImport,
  QUEUES.campaignStart,
  QUEUES.campaignDispatch,
  QUEUES.flowInbound,
  QUEUES.flowStart,
  QUEUES.webhookDeliver,
];

/**
 * - stately: at most one queued and one active job per singletonKey (the campaign id)
 * - key_strict_fifo: jobs with the same singletonKey (the conversation id) run one at a time, in
 *   order, so a chat's messages never race through a flow. Their handlers never throw: a failed
 *   job would hold back that chat's later messages.
 */
export const QUEUE_POLICIES: Partial<Record<string, "stately" | "key_strict_fifo">> = {
  [QUEUES.campaignDispatch]: "stately",
  [QUEUES.flowInbound]: "key_strict_fifo",
};

declare global {
  var __wacrmBoss: Promise<PgBoss> | undefined;
}

/**
 * Producer-side pg-boss for the web app: sends jobs only. Maintenance, schema migration and
 * cron scheduling run in the worker so the web process stays light.
 */
export function getQueue(): Promise<PgBoss> {
  globalThis.__wacrmBoss ??= (async () => {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      supervise: false,
      schedule: false,
      migrate: false,
      max: 3,
    });
    boss.on("error", (err) => console.error("[queue] pg-boss error:", err));
    await boss.start();
    return boss;
  })();
  return globalThis.__wacrmBoss;
}

export async function enqueue(queue: string, data: object, options: { singletonKey?: string; startAfter?: number | Date; retryLimit?: number; retryDelay?: number } = {}) {
  const boss = await getQueue();
  return boss.send(queue, data, { retryLimit: 3, retryDelay: 10, retryBackoff: true, ...options });
}
