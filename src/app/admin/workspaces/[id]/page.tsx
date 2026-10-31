import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { effectiveStatus, usageAll } from "@/lib/billing/entitlements";
import { formatMoney } from "@/lib/billing/money";
import { LIMIT_KEYS, UNLIMITED, readLimits } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import { WorkspaceActions } from "./workspace-actions";

export const metadata: Metadata = { title: "Workspace" };

export default async function AdminWorkspacePage({ params }: PageProps<"/admin/workspaces/[id]">) {
  const t = await getTranslations("adminWorkspaces");
  const { id } = await params;
  const org = await db.organization.findUnique({
    where: { id },
    include: {
      subscription: { include: { plan: true } },
      memberships: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, email: true } } } },
      invoices: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!org) notFound();
  const [billing, usage, plans] = await Promise.all([getBilling(), usageAll(id), db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }], select: { id: true, name: true, isActive: true } })]);
  const sub = org.subscription;
  const status = sub ? effectiveStatus(sub, billing.graceDays, new Date()) : null;
  const limits = sub ? readLimits(sub.plan.limits) : null;
  const date = (d: Date | null | undefined) => (d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/workspaces" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          {org.suspendedAt && <Badge variant="destructive">{t("status.suspended")}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {org.slug} · {t("createdOn", { date: date(org.createdAt) })}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("subscription")}</CardTitle>
            <CardDescription>{billing.enabled ? t("subscriptionText") : t("billingOff")}</CardDescription>
          </CardHeader>
          <CardContent>
            {sub ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">{t("plan")}</dt>
                <dd className="font-medium">{sub.plan.name}</dd>
                <dt className="text-muted-foreground">{t("statusCol")}</dt>
                <dd>{status && <Badge variant={status.status === "ACTIVE" ? "default" : status.status === "TRIALING" ? "secondary" : "destructive"}>{t(`status.${status.status}`)}</Badge>}</dd>
                <dt className="text-muted-foreground">{t("interval")}</dt>
                <dd>{t(`intervalName.${sub.interval}`)}</dd>
                <dt className="text-muted-foreground">{t("periodEnd")}</dt>
                <dd>{sub.currentPeriodEnd ? date(sub.currentPeriodEnd) : t("noEnd")}</dd>
                {status?.graceEndsAt && (
                  <>
                    <dt className="text-muted-foreground">{t("graceEnds")}</dt>
                    <dd>{date(status.graceEndsAt)}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noSubscription")}</p>
            )}
            {org.suspendedAt && <p className="mt-3 text-sm text-destructive">{t("suspendedOn", { date: date(org.suspendedAt), reason: org.suspendedReason ?? "—" })}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("usage")}</CardTitle>
            <CardDescription>{t("usageText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
              {LIMIT_KEYS.map((k) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{t(`limit.${k}`)}</dt>
                  <dd className="text-end tabular-nums">
                    {usage[k].toLocaleString()}
                    {limits && ` / ${limits[k] === UNLIMITED ? "∞" : limits[k].toLocaleString()}`}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <WorkspaceActions
        orgId={org.id}
        suspended={!!org.suspendedAt}
        hasSubscription={!!sub}
        hasOwner={org.memberships.some((m) => m.role === "OWNER")}
        plans={plans}
        current={sub ? { planId: sub.planId, interval: sub.interval, periodEnd: sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? "" } : null}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("team")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {org.memberships.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.user.email}</div>
                </div>
                <Badge variant="outline">{m.role.toLowerCase()}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("invoices")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {!org.invoices.length && <p className="text-muted-foreground">{t("noInvoices")}</p>}
            {org.invoices.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <Link href={`/admin/invoices/${i.id}`} className="font-medium text-primary hover:underline">
                  {i.number}
                </Link>
                <span className="text-muted-foreground">{date(i.createdAt)}</span>
                <span className="tabular-nums">{formatMoney(i.total, i.currency)}</span>
                <Badge variant={i.status === "PAID" ? "default" : i.status === "VOID" ? "outline" : "secondary"}>{t(`invoiceStatus.${i.status}`)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
