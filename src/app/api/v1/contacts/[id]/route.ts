import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { apiV1, jsonBody } from "@/lib/api-v1";
import { contactApiInclude, contactJson } from "@/lib/api-v1-helpers";
import { fieldDefs } from "@/lib/crm/contacts";
import { mergeFieldValues } from "@/lib/crm/fields";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/v1/contacts/[id]">;

export const GET = apiV1<Ctx>(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const c = await orgDb(auth.orgId).contact.findUnique({ where: { id }, include: contactApiInclude });
  if (!c) throw new ApiError(404, "Contact not found.", "not_found");
  return NextResponse.json({ data: contactJson(c) });
});

const patchBody = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  opted_out: z.boolean().optional(),
});

/** PATCH /api/v1/contacts/:id — update; `fields` merges (null clears a field) */
export const PATCH = apiV1<Ctx>(async (req, ctx, auth) => {
  const { id } = await ctx.params;
  const input = patchBody.parse(await jsonBody(req));
  const tdb = orgDb(auth.orgId);
  const c = await tdb.contact.findUnique({ where: { id } });
  if (!c) throw new ApiError(404, "Contact not found.", "not_found");
  await tdb.contact.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email?.toLowerCase() ?? null } : {}),
      ...(input.fields ? { fields: mergeFieldValues(await fieldDefs(tdb), c.fields, input.fields) } : {}),
      ...(input.opted_out !== undefined ? { optedOut: input.opted_out, optedOutAt: input.opted_out ? new Date() : null } : {}),
    },
  });
  return NextResponse.json({ data: contactJson(await tdb.contact.findUniqueOrThrow({ where: { id }, include: contactApiInclude })) });
});
