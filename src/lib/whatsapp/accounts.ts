import { env } from "@/lib/env";
import type { WhatsAppAccount } from "@/generated/prisma/client";
import { effectiveDailyLimit, sentTodayFor, warmupDay } from "./anti-ban";

export function webhookUrlFor(accountId: string): string {
  return `${env().APP_URL.replace(/\/+$/, "")}/api/webhooks/whatsapp/${accountId}`;
}

/** Account as the browser may see it: never tokens/secrets; QR and webhook details for admins only */
export function publicAccount(a: WhatsAppAccount, opts: { admin: boolean }) {
  return {
    id: a.id,
    name: a.name,
    channel: a.channel,
    status: a.status,
    statusMessage: a.statusMessage,
    phone: a.phone,
    displayName: a.displayName,
    qualityRating: a.qualityRating,
    messagingTier: a.messagingTier,
    createdAt: a.createdAt,
    antiBan:
      a.channel === "QR"
        ? {
            warmupEnabled: a.warmupEnabled,
            warmupDay: a.connectedAt ? warmupDay(a.connectedAt) : null,
            minDelaySec: a.minDelaySec,
            maxDelaySec: a.maxDelaySec,
            dailyLimit: a.dailyLimit,
            todayLimit: effectiveDailyLimit(a),
            sentToday: sentTodayFor(a),
          }
        : null,
    ...(opts.admin
      ? {
          pendingQr: a.status === "QR_PENDING" ? a.pendingQr : null,
          official:
            a.channel === "OFFICIAL"
              ? { phoneNumberId: a.phoneNumberId, wabaId: a.wabaId, webhookUrl: webhookUrlFor(a.id), verifyToken: a.webhookVerifyToken }
              : null,
        }
      : {}),
  };
}
