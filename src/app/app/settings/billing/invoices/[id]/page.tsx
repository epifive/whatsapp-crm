import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { requireOrg } from "@/lib/auth/session";
import { getBranding } from "@/lib/settings";
import { orgDb } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/app/settings/billing/invoices/[id]">) {
  const session = await requireOrg("ADMIN");
  const { id } = await params;
  const [invoice, brand] = await Promise.all([orgDb(session.org.id).invoice.findUnique({ where: { id } }), getBranding()]);
  if (!invoice) notFound();
  return <InvoiceDocument invoice={invoice} logoUrl={brand.logoUrl} appName={brand.appName} />;
}
