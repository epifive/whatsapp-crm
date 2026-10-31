import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: { client: PrismaClient; url: string } | undefined;
}

function client(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("The database isn't configured yet. Open /install to set up the app.");
  // Created on first use (not at import), so the web installer can set DATABASE_URL first
  if (globalThis.__prisma?.url !== url) {
    void globalThis.__prisma?.client.$disconnect().catch(() => null);
    globalThis.__prisma = { client: new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }), url };
  }
  return globalThis.__prisma.client;
}

/**
 * Unscoped client. Platform-level code only (auth, admin, installer) — tenant data must go
 * through `orgDb(orgId)` from src/lib/tenancy so every query is limited to one organization.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
