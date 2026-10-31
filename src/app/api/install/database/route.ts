import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, route } from "@/lib/api";
import { assertNotInstalled, databaseSchema, databaseUrl, testDatabase } from "@/lib/installer";
import { rateLimit } from "@/lib/rate-limit";

/** Installer: try the database connection (form details, or DATABASE_URL from the environment) */
export const POST = route(async (req) => {
  assertNotInstalled();
  if (!rateLimit(`install-db:${clientIp(req)}`, 30, 10 * 60_000).ok) throw new ApiError(429, "Too many attempts. Wait a few minutes.");
  const { database } = await parseBody(req, z.object({ database: databaseSchema.optional() }));
  const url = database ? databaseUrl(database) : process.env.DATABASE_URL;
  if (!url) throw new ApiError(400, "Enter the database details.");
  const check = await testDatabase(url);
  if (check.hasTables && !check.ourSchema) throw new ApiError(400, "This database already has other tables. Use an empty database for the app.");
  return NextResponse.json(check);
});
