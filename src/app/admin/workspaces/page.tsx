import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { effectiveStatus } from "@/lib/billing/entitlements";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Workspaces" };

const PAGE = 50;
const STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "EXPIRED", "suspended", "none"] as const;

export default async function AdminWorkspacesPage({ searchParams }: PageProps<"/admin/workspaces">) {
  const t = await getTranslations("adminWorkspaces");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.OrganizationWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { memberships: { some: { user: { email: { contains: q, mode: "insensitive" } } } } }] } : {}),
    ...(status === "suspended" ? { suspendedAt: { not: null } } : status === "none" ? { subscription: null } : status ? { subscription: { status: status as never } } : {}),
  };
  const [rows, total, billing] = await Promise.all([
    db.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      skip: (page - 1) * PAGE,
      include: {
        subscription: { include: { plan: { select: { name: true } } } },
        memberships: { where: { role: "OWNER" }, take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } },
        _count: { select: { memberships: true, whatsappAccounts: true, contacts: true } },
      },
    }),
    db.organization.count({ where }),
    getBilling(),
  ]);
  const now = new Date();
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/admin/workspaces?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}), page: String(p) })}`;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { count: total })}</p>
      </div>
      <form className="flex flex-wrap gap-2" action="/admin/workspaces">
        <Input name="q" defaultValue={q} placeholder={t("search")} aria-label={t("search")} className="max-w-xs" />
        <NativeSelect name="status" defaultValue={status} aria-label={t("statusFilter")} className="w-auto">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>
      <Card className="py-0">
        <CardContent className="relative overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-start text-xs text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t("workspace")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("plan")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("statusCol")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("periodEnd")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("members")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("numbers")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("contacts")}</th>
                <th className="px-4 py-2.5 text-start font-medium">{t("created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const s = o.subscription;
                const st = s ? effectiveStatus(s, billing.graceDays, now).status : null;
                return (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="max-w-64 px-4 py-2.5">
                      <Link href={`/admin/workspaces/${o.id}`} className="block truncate font-medium text-primary hover:underline">
                        {o.name}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{o.memberships[0]?.user.email ?? o.slug}</div>
                    </td>
                    <td className="px-4 py-2.5">{s?.plan.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {st && <Badge variant={st === "ACTIVE" ? "default" : st === "TRIALING" ? "secondary" : "destructive"}>{t(`status.${st}`)}</Badge>}
                        {o.suspendedAt && <Badge variant="destructive">{t("status.suspended")}</Badge>}
                        {!st && !o.suspendedAt && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{s?.currentPeriodEnd ? s.currentPeriodEnd.toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{o._count.memberships}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{o._count.whatsappAccounts}</td>
                    <td className="px-4 py-2.5 text-end tabular-nums">{o._count.contacts.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{o.createdAt.toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
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
