import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getBilling } from "@/lib/settings";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "./mode";
import { seedDemo } from "./seed";
import { STORAGE_ROOT } from "@/lib/paths";

const MEDIA_ROOT = path.join(STORAGE_ROOT, "media");

/**
 * Live demo: wipes every workspace and account (and their files) and builds the Demo Store
 * again with the three demo accounts. Platform settings and plans stay as they are (the demo
 * doesn't let visitors change them). Run by the worker on a schedule and by `npm run demo:reset`.
 */
export async function resetDemo(): Promise<{ orgId: string }> {
  const orgs = await db.organization.findMany({ select: { id: true } });
  // Workspaces take their contacts, chats, deals, flows, invoices… with them
  await db.organization.deleteMany({});
  await db.user.deleteMany({});
  await db.auditLog.deleteMany({});
  await Promise.all(orgs.map((o) => fs.rm(path.join(MEDIA_ROOT, o.id), { recursive: true, force: true })));

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const [admin, owner, agent] = await Promise.all(
    DEMO_ACCOUNTS.map((a) =>
      db.user.create({
        data: { email: a.email, name: a.name, passwordHash, emailVerifiedAt: new Date(), ...(a.key === "admin" ? { platformRole: "SUPER_ADMIN" as const } : {}) },
      }),
    ),
  );
  const orgId = await seedDemo(owner!.id, { currency: (await getBilling()).currency, teammateId: agent!.id });
  if (!orgId) throw new Error("The demo workspace wasn't created.");
  // The platform admin can open the workspace too
  await db.membership.create({ data: { orgId, userId: admin!.id, role: "ADMIN" } });
  return { orgId };
}
