"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, Eye, FlaskConical } from "lucide-react";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";

/** One line above the header: "view as" sessions, the live demo, then the workspace's plan status */
export type ShellNotice =
  | { kind: "impersonating"; name: string; email: string }
  | { kind: "demo"; hours: number }
  | { kind: "suspended"; reason: string | null }
  | { kind: "locked" }
  | { kind: "pastDue"; graceEndsAt: string }
  | { kind: "trial"; daysLeft: number };

export const NOTICE_HEIGHT = "2.25rem";

export function ShellNoticeBar({ notice, canManageBilling }: { notice: ShellNotice; canManageBilling: boolean }) {
  const t = useTranslations("shellNotice");
  const router = useRouter();

  async function stopViewing() {
    const res = await apiFetch<{ redirect: string }>("/api/auth/impersonation/stop", { body: {} });
    router.replace(res.ok ? res.data!.redirect : "/login");
    router.refresh();
  }

  const tone =
    notice.kind === "impersonating"
      ? "bg-violet-600 text-white"
      : notice.kind === "suspended" || notice.kind === "locked"
        ? "bg-destructive text-white"
        : notice.kind === "pastDue"
          ? "bg-amber-500 text-black"
          : notice.kind === "demo"
            ? "bg-sky-600 text-white"
            : "bg-primary/10 text-foreground";
  const Icon = notice.kind === "impersonating" ? Eye : notice.kind === "trial" ? Clock : notice.kind === "demo" ? FlaskConical : AlertTriangle;

  let message: string;
  if (notice.kind === "impersonating") message = t("impersonating", { name: notice.name, email: notice.email });
  else if (notice.kind === "demo") message = t("demo", { hours: notice.hours });
  else if (notice.kind === "suspended") message = notice.reason ? t("suspendedReason", { reason: notice.reason }) : t("suspended");
  else if (notice.kind === "locked") message = t("locked");
  else if (notice.kind === "pastDue") message = t("pastDue", { date: new Date(notice.graceEndsAt).toLocaleDateString() });
  else message = t("trial", { days: notice.daysLeft });

  const action =
    notice.kind === "impersonating" ? (
      <button type="button" onClick={() => void stopViewing()} className="shrink-0 rounded bg-white/20 px-2 py-0.5 font-medium hover:bg-white/30">
        {t("stopViewing")}
      </button>
    ) : notice.kind !== "suspended" && notice.kind !== "demo" && canManageBilling ? (
      <Link href="/app/settings/billing" className="shrink-0 rounded bg-black/10 px-2 py-0.5 font-medium hover:bg-black/20 dark:bg-white/20">
        {notice.kind === "trial" ? t("choosePlan") : t("renew")}
      </Link>
    ) : null;

  return (
    <div role="status" className={cn("flex items-center gap-2 px-4 text-sm sm:px-6 print:hidden", tone)} style={{ height: NOTICE_HEIGHT }}>
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      {action}
    </div>
  );
}
