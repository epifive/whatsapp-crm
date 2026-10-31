import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/settings";

export const metadata: Metadata = { title: "Invoice" };

export default async function AdminInvoicePage({ params }: PageProps<"/admin/invoices/[id]">) {
  const { id } = await params;
  const [invoice, brand] = await Promise.all([db.invoice.findUnique({ where: { id } }), getBranding()]);
  if (!invoice) notFound();
  return <InvoiceDocument invoice={invoice} logoUrl={brand.logoUrl} appName={brand.appName} />;
}
