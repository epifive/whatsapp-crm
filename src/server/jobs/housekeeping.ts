import { db } from "@/lib/db";
import { expireSessions } from "@/lib/flows/engine";

const DELIVERY_LOG_DAYS = 14;

/** Worker cron (every 5 minutes): expire flow sessions nobody answered, prune old webhook logs */
export async function automationHousekeeping(now = new Date()) {
  const expired = await expireSessions(now);
  const { count: pruned } = await db.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DELIVERY_LOG_DAYS * 86_400_000) } } });
  return { expired, pruned };
}
