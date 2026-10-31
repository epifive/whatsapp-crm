import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Circle } from "lucide-react";
import { formatMoney } from "@/components/crm/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { endOfDayIn, daysAgo } from "@/lib/time";
import { orgDb } from "@/lib/tenancy";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await requireOrg();
  const t = await getTranslations("dashboard");
  const tdb = orgDb(session.org.id);
  const weekAgo = daysAgo(7);
  const [members, pendingInvites, numbers, contacts, newContacts, openChats, openDeals, tasksDue, deals, campaigns] = await Promise.all([
    tdb.membership.count(),
    tdb.invitation.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
    tdb.whatsAppAccount.count(),
    tdb.contact.count(),
    tdb.contact.count({ where: { createdAt: { gte: weekAgo } } }),
    tdb.conversation.count({ where: { status: "OPEN" } }),
    tdb.deal.aggregate({ where: { status: "OPEN" }, _count: { _all: true }, _sum: { value: true } }),
    tdb.task.count({ where: { assigneeId: session.user.id, completedAt: null, dueAt: { lte: endOfDayIn(session.org.timezone, new Date()) } } }),
    tdb.deal.count(),
    tdb.campaign.count({ where: { status: { not: "DRAFT" } } }),
  ]);

  const stats = [
    { label: t("contacts"), value: contacts.toLocaleString("en"), hint: t("newThisWeek", { count: newContacts }), href: "/app/contacts" },
    { label: t("openChats"), value: openChats.toLocaleString("en"), href: "/app/inbox" },
    {
      label: t("openDeals"),
      value: formatMoney(openDeals._sum.value?.toNumber() ?? 0, session.org.currency, "en"),
      hint: t("dealCount", { count: openDeals._count._all }),
      href: "/app/deals",
    },
    { label: t("tasksDue"), value: tasksDue.toLocaleString("en"), hint: t("tasksDueHint"), href: "/app/tasks" },
  ];

  // Getting-started checklist; later milestones add steps (first campaign, first flow, ...)
  const steps = [
    { done: true, label: t("stepCreateOrg") },
    { done: numbers > 0, label: t("stepConnectNumber"), href: "/app/settings/numbers" },
    { done: members > 1 || pendingInvites > 0, label: t("stepInviteTeam"), href: "/app/settings/team" },
    { done: contacts > 0, label: t("stepImportContacts"), href: "/app/contacts/import" },
    { done: deals > 0, label: t("stepFirstDeal"), href: "/app/deals" },
    { done: campaigns > 0, label: t("stepFirstCampaign"), href: "/app/campaigns" },
  ];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("welcome", { name: session.user.name.split(" ")[0] })}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { org: session.org.name })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Card className="h-full">
              <CardHeader>
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="truncate text-3xl tabular-nums">{s.value}</CardTitle>
                {s.hint && <p className="text-xs text-muted-foreground">{s.hint}</p>}
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      {steps.some((s) => !s.done) && (
        <Card>
          <CardHeader>
            <CardTitle>{t("gettingStarted")}</CardTitle>
            <CardDescription>{t("gettingStartedText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {steps.map((step) => (
                <li key={step.label} className="flex items-center gap-3 text-sm">
                  {step.done ? <CheckCircle2 className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground" />}
                  {step.href && !step.done ? (
                    <Link href={step.href} className="font-medium hover:underline">
                      {step.label}
                    </Link>
                  ) : (
                    <span className={step.done ? "text-muted-foreground line-through" : "font-medium"}>{step.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
