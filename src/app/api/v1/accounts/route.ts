import { NextResponse } from "next/server";
import { apiV1 } from "@/lib/api-v1";
import { orgDb } from "@/lib/tenancy";

/** GET /api/v1/accounts — the workspace's WhatsApp numbers */
export const GET = apiV1(async (_req, _ctx, auth) => {
  const accounts = await orgDb(auth.orgId).whatsAppAccount.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    data: accounts.map((a) => ({ id: a.id, name: a.name, channel: a.channel === "OFFICIAL" ? "cloud_api" : "qr", phone: a.phone, status: a.status.toLowerCase() })),
  });
});
