import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/billing/money";
import type { Invoice } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

interface Party {
  name?: string | null;
  email?: string | null;
  address?: string | null;
  taxId?: string | null;
  footer?: string | null;
}

/** The invoice as a printable page (the browser's "Save as PDF" makes the PDF) */
export async function InvoiceDocument({ invoice, logoUrl, appName }: { invoice: Invoice; logoUrl: string | null; appName: string }) {
  const t = await getTranslations("invoice");
  const seller = (invoice.seller ?? {}) as Party;
  const buyer = (invoice.billTo ?? {}) as Party;
  const money = (n: number) => formatMoney(n, invoice.currency);
  const date = (d: Date) => d.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="grid gap-4">
      <div className="flex justify-end print:hidden">
        <PrintButton label={t("print")} />
      </div>
      <article className="mx-auto w-full max-w-3xl rounded-xl border bg-white p-6 text-sm text-neutral-900 shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl ? <img src={logoUrl} alt={appName} className="h-10 w-auto" /> : <div className="text-lg font-bold">{seller.name || appName}</div>}
            <div className="mt-3 whitespace-pre-line text-neutral-600">
              {/* Without a logo the name is already the heading above */}
              {logoUrl && seller.name && <div className="font-medium text-neutral-900">{seller.name}</div>}
              {seller.address}
              {seller.taxId && <div>{t("taxId", { id: seller.taxId })}</div>}
            </div>
          </div>
          <div className="text-end">
            <div className="text-2xl font-semibold tracking-tight">{t("title")}</div>
            <div className="mt-1 text-neutral-600">{invoice.number}</div>
            <div
              className={cn(
                "mt-2 inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase",
                invoice.status === "PAID" ? "bg-green-100 text-green-800" : invoice.status === "VOID" ? "bg-neutral-200 text-neutral-700" : "bg-amber-100 text-amber-800",
              )}
            >
              {t(`status.${invoice.status}`)}
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase text-neutral-500">{t("billTo")}</div>
            <div className="mt-1 whitespace-pre-line">
              <div className="font-medium">{buyer.name}</div>
              {buyer.email && <div>{buyer.email}</div>}
              {buyer.address}
              {buyer.taxId && <div>{t("taxId", { id: buyer.taxId })}</div>}
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 sm:justify-self-end">
            <dt className="text-neutral-500">{t("issued")}</dt>
            <dd>{date(invoice.createdAt)}</dd>
            {invoice.paidAt && (
              <>
                <dt className="text-neutral-500">{t("paid")}</dt>
                <dd>{date(invoice.paidAt)}</dd>
              </>
            )}
          </dl>
        </section>

        <table className="mt-8 w-full">
          <thead>
            <tr className="border-b text-start text-xs uppercase text-neutral-500">
              <th className="py-2 text-start font-semibold">{t("description")}</th>
              <th className="py-2 text-end font-semibold">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className="py-3">{invoice.description}</td>
              <td className="py-3 text-end tabular-nums">{money(invoice.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="ms-auto mt-4 grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5">
          <dt className="text-neutral-500">{t("subtotal")}</dt>
          <dd className="text-end tabular-nums">{money(invoice.subtotal)}</dd>
          {invoice.discount > 0 && (
            <>
              <dt className="text-neutral-500">{invoice.couponCode ? t("discountCode", { code: invoice.couponCode }) : t("discount")}</dt>
              <dd className="text-end tabular-nums">− {money(invoice.discount)}</dd>
            </>
          )}
          {invoice.tax > 0 && (
            <>
              <dt className="text-neutral-500">{invoice.taxLabel ?? t("tax")}</dt>
              <dd className="text-end tabular-nums">{money(invoice.tax)}</dd>
            </>
          )}
          <dt className="border-t pt-2 font-semibold">{t("total")}</dt>
          <dd className="border-t pt-2 text-end font-semibold tabular-nums">{money(invoice.total)}</dd>
        </dl>

        {seller.footer && <footer className="mt-10 whitespace-pre-line border-t pt-4 text-xs text-neutral-500">{seller.footer}</footer>}
      </article>
    </div>
  );
}
