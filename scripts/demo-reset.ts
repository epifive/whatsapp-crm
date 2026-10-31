/**
 * Live demo server only: wipes ALL workspaces and accounts and creates the demo data and the
 * demo accounts (see src/lib/demo). Needs DEMO_MODE=true in .env so it can't run by accident.
 *   npm run demo:reset
 * Afterwards the worker repeats the reset every DEMO_RESET_HOURS (default 3).
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemo } from "@/lib/demo/mode";
import { resetDemo } from "@/lib/demo/reset";
import { writeInstallLock } from "@/lib/install-state";

async function main() {
  if (!isDemo()) throw new Error("This deletes every workspace and account. It only runs with DEMO_MODE=true in .env (a public demo server).");
  await resetDemo();
  writeInstallLock({ via: "demo:reset" });
  console.log(`Demo ready. Accounts (password "${DEMO_PASSWORD}"): ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await db.$disconnect();
  process.exit(1);
});
