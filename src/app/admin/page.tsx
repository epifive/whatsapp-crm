import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/billing/money";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import { getWorkerStatus } from "@/lib/worker-status";
import { cn } from "@/lib/utils";
import { daysAgo } from "@/lib/time";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  const t = await getTranslations("admin");
  const since = daysAgo(30);
  const [users, verified, orgs, newUsers, worker, billing, active, trials, revenue, toReview] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { emailVerifiedAt: { not: null } } }),
    db.organization.count(),
    db.user.count({ where: { createdAt: { gte: since } } }),
    getWorkerStatus(),
    getBilling(),
    db.subscription.count({ where: { status: "ACTIVE", plan: { OR: [{ priceMonthly: { gt: 0 } }, { priceYearly: { gt: 0 } }] } } }),
    db.subscription.count({ where: { status: "TRIALING" } }),
    db.invoice.groupBy({ by: ["currency"], where: { status: "PAID", paidAt: { gte: since } }, _sum: { total: true } }),
    db.payment.count({ where: { status: "REVIEW" } }),
  ]);
  const revenueText = revenue.length ? revenue.map((r) => formatMoney(r._sum.total ?? 0, r.currency)).join(" + ") : formatMoney(0, billing.currency);
  const stats = [
    { label: t("users"), value: users },
    { label: t("verifiedUsers"), value: verified },
    { label: t("organizations"), value: orgs },
    { label: t("newUsers30d"), value: newUsers },
  ];
  const billingStats = [
    { label: t("revenue30d"), value: revenueText },
    { label: t("paidSubscriptions"), value: active },
    { label: t("trials"), value: trials },
    { label: t("paymentsToReview"), value: toReview, href: "/admin/invoices?status=review" },
  ];
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("overview")}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className={cn("size-2.5 rounded-full", worker.online ? "bg-primary" : "bg-destructive")} />
            {t("workerTitle")}: {worker.online ? t("workerOnline") : t("workerOffline")}
          </CardTitle>
          <CardDescription>
            {worker.lastSeen ? t("workerLastSeen", { time: worker.lastSeen.toLocaleString() }) : t("workerNeverSeen")}
          </CardDescription>
        </CardHeader>
        {!worker.online && (
          <CardContent className="text-sm text-muted-foreground">
            {t("workerHint")} <code className="rounded bg-muted px-1.5 py-0.5">npm run worker</code>
          </CardContent>
        )}
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="text-3xl">{s.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {billing.enabled ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {billingStats.map((s) => (
            <Card key={s.label}>
              <CardHeader>
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="truncate text-2xl">{s.href && s.value ? <Link href={s.href} className="text-primary hover:underline">{s.value}</Link> : s.value}</CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("billingOff")}</CardTitle>
            <CardDescription>
              {t("billingOffText")}{" "}
              <Link href="/admin/settings#billing" className="text-primary hover:underline">
                {t("billingOffLink")}
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
