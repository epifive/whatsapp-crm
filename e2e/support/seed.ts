/**
 * Runs (through tsx) against the e2e database: the platform super admin and the Demo Store
 * workspace the layout scan browses. Called by global-setup with DATABASE_URL set.
 */
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { seedDemo } from "@/lib/demo/seed";

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) throw new Error("Usage: seed.ts <email> <name> <password>");
  const admin = await db.user.create({
    data: { email, name, passwordHash: hashPassword(password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() },
  });
  await seedDemo(admin.id);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
