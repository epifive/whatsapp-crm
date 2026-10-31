import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

/** Records who did what. Never throws: an audit failure must not break the action itself. */
export async function audit(entry: {
  action: string;
  orgId?: string | null;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  meta?: Prisma.InputJsonValue;
  ip?: string;
}): Promise<void> {
  try {
    await db.auditLog.create({ data: { ...entry, orgId: entry.orgId ?? null, userId: entry.userId ?? null } });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}
