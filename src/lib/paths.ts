import path from "node:path";

/**
 * Writable folder for media, the mail outbox and the install lock. Defaults to ./storage
 * (a volume in Docker). STORAGE_DIR overrides it; on serverless hosts such as Vercel, where
 * the app folder is read-only, it falls back to /tmp (files there are not kept between runs).
 * Dependency-free so the custom server and the worker can use it before anything else loads.
 */
export const STORAGE_ROOT =
  process.env.STORAGE_DIR?.trim() || (process.env.VERCEL ? path.join("/tmp", "storage") : path.join(process.cwd(), "storage"));
