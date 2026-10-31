import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { fulfilPayment } from "@/lib/billing/checkout";
import { db } from "@/lib/db";

/**
 * POST /api/admin/invoices/:id/mark-paid   confirm an offline payment (starts the plan)
 * POST /api/admin/invoices/:id/void        cancel an unpaid invoice
 */
export const POST = route<RouteContext<"/api/admin/invoices/[id]/[action]">>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id, action } = await ctx.params;
  const invoice = await db.invoice.findUnique({ where: { id }, include: { payments: { orderBy: { createdAt: "desc" } } } });
  if (!invoice) throw new ApiError(404, "Invoice not found.");
  if (invoice.status === "PAID") throw new ApiError(409, "This invoice is already paid.");

  if (action === "mark-paid") {
    // The customer's reported payment, or a new manual record when they paid some other way
    const payment =
      invoice.payments.find((p) => p.status === "REVIEW" || p.status === "PENDING") ??
      (await db.payment.create({ data: { invoiceId: id, orgId: invoice.orgId, gateway: "MANUAL", amount: invoice.total, currency: invoice.currency } }));
    if (!(await fulfilPayment(payment.id, {}))) throw new ApiError(409, "This payment was already processed.");
  } else if (action === "void") {
    await db.payment.updateMany({ where: { invoiceId: id, status: { in: ["PENDING", "REVIEW"] } }, data: { status: "FAILED", error: "Invoice cancelled by the platform admin." } });
    await db.invoice.update({ where: { id }, data: { status: "VOID" } });
  } else {
    throw new ApiError(404, "Unknown action.");
  }
  await audit({ action: `admin.invoice.${action}`, orgId: invoice.orgId, userId: session.user.id, targetType: "invoice", targetId: id, meta: { number: invoice.number }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
