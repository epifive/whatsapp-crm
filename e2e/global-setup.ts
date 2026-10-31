import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { APP_URL, E2E, META_URL } from "./support/env";
import { startMockMeta } from "./support/mock-meta";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logDir = path.join(root, "e2e", ".logs");
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

/** Drops and recreates the e2e database and applies the migrations */
async function resetDatabase() {
  const target = new URL(E2E.databaseUrl);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/_e2e$/.test(dbName)) throw new Error(`Refusing to wipe "${dbName}": the e2e database name must end with _e2e.`);

  const server = new URL(E2E.databaseUrl);
  server.pathname = "/postgres";
  const admin = new Client({ connectionString: server.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const prisma = path.join(root, "node_modules", "prisma", "build", "index.js");
  const migrate = spawnSync(process.execPath, [prisma, "migrate", "deploy"], { cwd: root, env: env(), encoding: "utf8" });
  if (migrate.status !== 0) throw new Error(`prisma migrate deploy failed:\n${migrate.stdout}\n${migrate.stderr}`);
}

function env(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: E2E.databaseUrl,
    APP_URL,
    PORT: String(E2E.appPort),
    HOST: "127.0.0.1",
    WHATSAPP_GRAPH_BASE: META_URL,
    // Flow HTTP steps and workspace webhooks may call the local test servers
    ALLOW_PRIVATE_NETWORK_REQUESTS: "true",
  };
}

function start(name: string, args: string[], extraEnv: Record<string, string> = {}): ChildProcess {
  const log = fs.openSync(path.join(logDir, `${name}.log`), "w");
  return spawn(process.execPath, [tsx, ...args], { cwd: root, env: { ...env(), ...extraEnv }, stdio: ["ignore", log, log] });
}

async function waitFor(url: string, child: ChildProcess, name: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`The ${name} exited (code ${child.exitCode}); see e2e/.logs/${name}.log`);
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`The ${name} didn't answer ${url} within ${timeoutMs / 1000}s; see e2e/.logs/${name}.log`);
}

function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

export default async function globalSetup() {
  if (!process.env.APP_KEY) throw new Error("Set APP_KEY in .env to run the e2e tests.");
  fs.mkdirSync(logDir, { recursive: true });

  await resetDatabase();
  const seed = spawnSync(process.execPath, [tsx, "e2e/support/seed.ts", E2E.admin.email, E2E.admin.name, E2E.admin.password], {
    cwd: root,
    env: env(),
    encoding: "utf8",
  });
  if (seed.status !== 0) throw new Error(`Seeding the e2e database failed:\n${seed.stdout}\n${seed.stderr}`);
  // The custom server and the worker only run once the app counts as installed
  const lock = path.join(root, "storage", "installed.json");
  if (!fs.existsSync(lock)) {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ installedAt: new Date().toISOString(), note: "e2e" }, null, 2));
  }

  const meta = await startMockMeta(E2E.metaPort);
  // A production build is much faster to browse; without one the tests use the dev server
  const production = fs.existsSync(path.join(root, ".next", "BUILD_ID"));
  const app = start("app", ["server.ts"], { NODE_ENV: production ? "production" : "development" });
  const worker = start("worker", ["src/server/worker.ts"]);

  try {
    await waitFor(`${APP_URL}/login`, app, "app", 180_000);
    // Worker heartbeat: any request handled by the worker isn't observable, so wait for its log line
    const until = Date.now() + 60_000;
    while (!fs.readFileSync(path.join(logDir, "worker.log"), "utf8").includes("Worker started")) {
      if (worker.exitCode !== null || Date.now() > until) throw new Error("The worker didn't start; see e2e/.logs/worker.log");
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (err) {
    stop(app);
    stop(worker);
    meta.close();
    throw err;
  }

  return async () => {
    stop(app);
    stop(worker);
    await new Promise((r) => meta.close(r));
  };
}
