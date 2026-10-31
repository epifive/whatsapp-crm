import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { contactWhere, fieldDefs, parseContactQuery } from "@/lib/crm/contacts";
import { csvLine } from "@/lib/crm/csv";
import { rateLimit } from "@/lib/rate-limit";
import { orgDb } from "@/lib/tenancy";

const PAGE = 1000;

/** CSV download of the contacts matching the list filters (admins only: it is the whole address book) */
export const GET = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  if (!rateLimit(`export:${session.user.id}`, 10, 60 * 60 * 1000).ok) throw new ApiError(429, "Too many exports. Try again in a while.");
  const tdb = orgDb(session.org.id);
  const where = await contactWhere(tdb, parseContactQuery(req.nextUrl.searchParams));
  const defs = await fieldDefs(tdb);
  const total = await tdb.contact.count({ where });
  await audit({ action: "contacts.exported", orgId: session.org.id, userId: session.user.id, meta: { count: total }, ip: clientIp(req) });

  const header = ["phone", "name", "whatsapp_name", "email", "tags", "owner", "opted_in_at", "opted_out", "source", "created_at", ...defs.map((d) => d.key)];
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let started = false;

  // Streams page by page so large address books don't sit in memory
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(String.fromCharCode(0xfeff) + csvLine(header))); // BOM: Excel opens UTF-8 correctly
      }
      const rows = await tdb.contact.findMany({
        where,
        include: { tags: { select: { tag: { select: { name: true } } } }, owner: { select: { email: true } } },
        orderBy: { id: "asc" },
        take: PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const c of rows) {
        const fields = (c.fields ?? {}) as Record<string, unknown>;
        controller.enqueue(
          encoder.encode(
            csvLine([
              c.phone,
              c.name,
              c.waName,
              c.email,
              c.tags.map((t) => t.tag.name).join(", "),
              c.owner?.email,
              c.optedInAt?.toISOString(),
              c.optedOut ? "yes" : "no",
              c.source,
              c.createdAt.toISOString(),
              ...defs.map((d) => fields[d.key]),
            ]),
          ),
        );
      }
      if (rows.length < PAGE) controller.close();
      else cursor = rows[rows.length - 1]!.id;
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
