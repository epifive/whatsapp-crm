import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/billing/money";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { InvoiceActions } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoices" };

const PAGE = 50;
const FILTERS = ["review", "open", "paid", "void"] as const;

export default async function AdminInvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  const t = await getTranslations("adminInvoices");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = typeof sp.status === "string" && (FILTERS as readonly string[]).includes(sp.status) ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.InvoiceWhereInput = {
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { org: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(status === "review" ? { status: "OPEN", payments: { some: { status: "REVIEW" } } } : status ? { status: status.toUpperCase() as never } : {}),
  };
  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      include: { org: { select: { id: true, name: true } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    db.invoice.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/admin/invoices?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <form className="flex flex-wrap gap-2" action="/admin/invoices">
        <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="max-w-xs" />
        <NativeSelect name="status" defaultValue={status} aria-label={t("statusFilter")} className="w-auto">
          <option value="">{t("all")}</option>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`filter.${f}`)}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>
      <Card className="py-0">
        <CardContent className="relative overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t("invoice")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("workspace")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("gateway")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("total")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">
                  <span className="sr-only">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const p = i.payments[0];
                const review = i.status === "OPEN" && p?.status === "REVIEW";
                return (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/invoices/${i.id}`} className="font-medium text-primary hover:underline">
                        {i.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {i.createdAt.toLocaleDateString()} · {i.description}
                      </div>
                    </td>
                    <td className="max-w-48 px-4 py-2.5">
                      <Link href={`/admin/workspaces/${i.org.id}`} className="block truncate hover:underline">
                        {i.org.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      {p ? t(`gatewayName.${p.gateway}`) : "—"}
                      {p?.reference && <div className="max-w-40 truncate text-xs text-muted-foreground">{t("reference", { ref: p.reference })}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{formatMoney(i.total, i.currency)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={i.status === "PAID" ? "default" : review ? "destructive" : i.status === "VOID" ? "outline" : "secondary"}>{review ? t("filter.review") : t(`filter.${i.status.toLowerCase()}`)}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-end">{i.status === "OPEN" && <InvoiceActions invoiceId={i.id} number={i.number} />}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("pageOf", { page, pages })}</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={link(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("previous")}
              </Link>
            )}
            {page < pages && (
              <Link href={link(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("next")}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
