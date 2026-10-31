/**
 * Creates (or promotes) a platform super admin.
 *   npm run create-admin -- --email you@example.com --name "Your Name" --password "a-strong-password"
 * The web installer does this for you on a fresh install; this script is for recovery/CLI setups
 * (it also marks the app as installed, which closes the web installer).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { writeInstallLock } from "@/lib/install-state";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation";

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, password: { type: "string" } },
  });
  const email = emailSchema.parse(values.email);
  const name = nameSchema.parse(values.name ?? "Administrator");
  const password = passwordSchema.parse(values.password);

  const user = await db.user.upsert({
    where: { email },
    create: { email, name, passwordHash: hashPassword(password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() },
    update: { platformRole: "SUPER_ADMIN", passwordHash: hashPassword(password), sessionVersion: { increment: 1 }, emailVerifiedAt: new Date() },
  });
  // A command-line setup counts as installed: the web installer stays closed
  writeInstallLock({ admin: user.email, via: "create-admin" });
  console.log(`Super admin ready: ${user.email}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
