import fs from "node:fs";
import path from "node:path";
import { STORAGE_ROOT } from "./paths";

/**
 * Whether the web installer has finished. The lock file lives in storage/ (a writable volume in
 * Docker) and is created by the installer or by `npm run create-admin`. Dependency-free so the
 * custom server and the worker can check it before anything else loads.
 */
export const INSTALL_LOCK = path.join(STORAGE_ROOT, "installed.json");

let installed = false;

export function isInstalled(): boolean {
  // Hosts without a writable disk (e.g. Vercel) mark an installed app with APP_INSTALLED=true
  if (process.env.APP_INSTALLED === "true") return true;
  // Once installed, always installed (the check runs on every request until then)
  if (!installed) installed = fs.existsSync(INSTALL_LOCK);
  return installed;
}

export function writeInstallLock(info: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(INSTALL_LOCK), { recursive: true });
  fs.writeFileSync(INSTALL_LOCK, JSON.stringify({ installedAt: new Date().toISOString(), ...info }, null, 2));
  installed = true;
}
