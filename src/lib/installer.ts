import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { z } from "zod";
import { UserInputError } from "@/lib/errors";
import { isInstalled, writeInstallLock } from "@/lib/install-state";
import { emailSchema, nameSchema, passwordSchema } from "@/lib/validation";

/**
 * The web installer (/install): checks the server, connects the database, writes .env, runs
 * the migrations and creates the platform admin. Everything here refuses to run once the app
 * is installed.
 */

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env");
const MIN_NODE = [20, 9];
const MIN_PG = 140000;

export function assertNotInstalled() {
  if (isInstalled()) throw new UserInputError("The app is already installed.");
}

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export interface Requirement {
  key: string;
  ok: boolean;
  detail: string;
}

export function checkRequirements(): Requirement[] {
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  const envProvided = !!process.env.DATABASE_URL && !!process.env.APP_KEY;
  const prisma = fs.existsSync(path.join(ROOT, "node_modules", "prisma", "build", "index.js"));
  return [
    { key: "node", ok: major > MIN_NODE[0]! || (major === MIN_NODE[0] && minor >= MIN_NODE[1]!), detail: `Node.js ${process.versions.node}` },
    // In Docker the settings come from the environment, so .env isn't needed
    { key: "envFile", ok: envProvided || writable(ROOT), detail: envProvided ? "DATABASE_URL and APP_KEY are set in the environment" : ENV_FILE },
    { key: "storage", ok: writable(path.join(ROOT, "storage")), detail: path.join(ROOT, "storage") },
    { key: "prisma", ok: prisma, detail: prisma ? "node_modules/prisma" : "Run npm install (the prisma package is missing)" },
    { key: "build", ok: process.env.NODE_ENV !== "production" || fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")), detail: process.env.NODE_ENV === "production" ? ".next (npm run build)" : "development mode" },
  ];
}

export const databaseSchema = z.union([
  z.object({ url: z.string().trim().regex(/^postgres(ql)?:\/\//, "The connection URL starts with postgresql://") }),
  z.object({
    host: z.string().trim().min(1, "Enter the database host."),
    port: z.coerce.number().int().min(1).max(65535).default(5432),
    database: z.string().trim().min(1, "Enter the database name."),
    user: z.string().trim().min(1, "Enter the database user."),
    password: z.string().default(""),
    ssl: z.boolean().default(false),
  }),
]);
export type DatabaseInput = z.infer<typeof databaseSchema>;

export function databaseUrl(input: DatabaseInput): string {
  if ("url" in input) return input.url;
  const u = new URL("postgresql://localhost");
  u.hostname = input.host;
  u.port = String(input.port);
  u.pathname = `/${encodeURIComponent(input.database)}`;
  u.username = encodeURIComponent(input.user);
  u.password = encodeURIComponent(input.password);
  if (input.ssl) u.searchParams.set("sslmode", "require");
  return u.toString();
}

export interface DatabaseCheck {
  version: string;
  // Tables already there: a previous install (migrations continue) or another app (refused)
  hasTables: boolean;
  ourSchema: boolean;
  hasAdmin: boolean;
}

export async function testDatabase(url: string): Promise<DatabaseCheck> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch (err) {
    throw new UserInputError(`Couldn't connect to the database: ${(err as Error).message}`);
  }
  try {
    const { rows } = await client.query<{ v: string; n: string }>("SELECT current_setting('server_version') AS v, current_setting('server_version_num') AS n");
    if (Number(rows[0]!.n) < MIN_PG) throw new UserInputError(`PostgreSQL ${rows[0]!.v} is too old: version 14 or newer is needed.`);
    const tables = await client.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()");
    const names = new Set(tables.rows.map((r) => r.name));
    const ourSchema = names.has("_prisma_migrations") && names.has("Organization");
    let hasAdmin = false;
    if (ourSchema) hasAdmin = Number((await client.query(`SELECT count(*) AS n FROM "User" WHERE "platformRole" = 'SUPER_ADMIN'`)).rows[0].n) > 0;
    return { version: rows[0]!.v, hasTables: names.size > 0, ourSchema, hasAdmin };
  } finally {
    await client.end().catch(() => null);
  }
}

/** .env text with these keys set, keeping everything else it already has */
export function mergeEnv(current: string | null, values: Record<string, string>): string {
  const lines = current !== null ? current.split(/\r?\n/) : ["# Written by the CRM for WhatsApp installer"];
  const left = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const key = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (key && left.has(key)) {
      const v = left.get(key)!;
      left.delete(key);
      return `${key}=${JSON.stringify(v)}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of left) out.push(`${k}=${JSON.stringify(v)}`);
  return out.join("\n") + "\n";
}

export function writeEnv(values: Record<string, string>) {
  fs.writeFileSync(ENV_FILE, mergeEnv(fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : null, values), { mode: 0o600 });
}

export function runMigrations(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cli = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
    const child = spawn(process.execPath, [cli, "migrate", "deploy"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 5 * 60_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new UserInputError(`Couldn't run the database migrations: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new UserInputError(`The database migrations failed:\n${output.slice(-1500)}`));
    });
  });
}

export const installSchema = z.object({
  database: databaseSchema.optional(),
  appUrl: z.string().trim().url("Enter the full address, e.g. https://crm.example.com").transform((v) => v.replace(/\/+$/, "")),
  appName: z.string().trim().min(1, "Enter the app name.").max(60),
  admin: z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }),
  demo: z.boolean().default(false),
});
export type InstallInput = z.infer<typeof installSchema>;

let running = false;

/** Runs the whole installation; returns where to sign in */
export async function install(input: InstallInput) {
  assertNotInstalled();
  if (running) throw new UserInputError("The installation is already running.");
  running = true;
  try {
    // Docker passes DATABASE_URL in the environment; otherwise it comes from the form
    const url = input.database ? databaseUrl(input.database) : process.env.DATABASE_URL;
    if (!url) throw new UserInputError("Enter the database details.");
    const check = await testDatabase(url);
    if (check.hasTables && !check.ourSchema) throw new UserInputError("This database already has other tables. Use an empty database for the app.");

    const appKey = process.env.APP_KEY && Buffer.from(process.env.APP_KEY, "base64").length >= 32 ? process.env.APP_KEY : crypto.randomBytes(32).toString("base64");
    await runMigrations(url);

    const values = { DATABASE_URL: url, APP_KEY: appKey, APP_URL: input.appUrl };
    const fromEnvironment = process.env.DATABASE_URL === url && process.env.APP_KEY === appKey;
    if (!(fromEnvironment && process.env.APP_URL === input.appUrl)) {
      try {
        writeEnv(values);
      } catch (err) {
        // Docker: settings come from the environment and the app folder is read-only
        if (!fromEnvironment) throw new UserInputError(`Couldn't write the settings file (.env): ${(err as Error).message}`);
      }
    }
    Object.assign(process.env, values);

    // Loaded after the environment is set: these modules read DATABASE_URL / APP_KEY
    const { db } = await import("@/lib/db");
    const { hashPassword } = await import("@/lib/auth/password");
    const { setSetting, DEFAULT_BRANDING } = await import("@/lib/settings");
    const admin = await db.user.upsert({
      where: { email: input.admin.email },
      create: { email: input.admin.email, name: input.admin.name, passwordHash: hashPassword(input.admin.password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date() },
      update: { name: input.admin.name, passwordHash: hashPassword(input.admin.password), platformRole: "SUPER_ADMIN", emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } },
    });
    await setSetting("branding", { ...DEFAULT_BRANDING, appName: input.appName });
    if (input.demo) {
      const { seedDemo } = await import("@/lib/demo/seed");
      await seedDemo(admin.id, { currency: "USD" });
    }
    writeInstallLock({ appUrl: input.appUrl, admin: admin.email });
    return { loginUrl: "/login", email: admin.email };
  } finally {
    running = false;
  }
}
