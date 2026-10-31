import "dotenv/config";

/**
 * Settings for the end-to-end tests. They run the app, the worker and a fake Meta Graph API
 * against their own database (never the development one), which is wiped on every run.
 */
function e2eDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL (or E2E_DATABASE_URL) in .env to run the e2e tests.");
  // Same server, a database of its own: wa_crm -> wa_crm_e2e
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/^\//, "")}_e2e`;
  return url.toString();
}

export const E2E = {
  appPort: Number(process.env.E2E_APP_PORT) || 3210,
  metaPort: Number(process.env.E2E_META_PORT) || 3299,
  databaseUrl: e2eDatabaseUrl(),
  admin: { name: "Alex Morgan", email: "admin@e2e.test", password: "E2e-admin-pass-1" },
};

export const APP_URL = `http://localhost:${E2E.appPort}`;
export const META_URL = `http://127.0.0.1:${E2E.metaPort}`;
