/**
 * Demo data for a platform admin:
 *   npm run seed:demo -- --email you@example.com
 * Adds a "Demo Store" workspace (owned by that admin) with sample contacts, chats, deals,
 * tasks, a campaign report, a chatbot flow and AI knowledge, plus four plans if none exist.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { getBilling } from "@/lib/settings";

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const admin = values.email
    ? await db.user.findUnique({ where: { email: values.email.toLowerCase() } })
    : await db.user.findFirst({ where: { platformRole: "SUPER_ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error(values.email ? `No user with the email ${values.email}.` : "Create the platform admin first (npm run create-admin).");
  const orgId = await seedDemo(admin.id, { currency: (await getBilling()).currency });
  console.log(orgId ? `Demo Store created for ${admin.email}.` : `${admin.email} already has a Demo Store; nothing changed.`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
