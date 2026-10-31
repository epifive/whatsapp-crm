import { AppShell } from "@/components/app-shell/app-shell";
import type { ShellNotice } from "@/components/app-shell/shell-notice";
import { requireOrg } from "@/lib/auth/session";
import { getEntitlements, type Entitlements } from "@/lib/billing/entitlements";
import { getBranding } from "@/lib/settings";
import { demoResetHours, isDemo } from "@/lib/demo/mode";

const DAY = 86_400_000;

function billingNotice(e: Entitlements): ShellNotice | null {
  const now = Date.now();
  if (e.locked === "suspended") return { kind: "suspended", reason: e.suspendedReason };
  if (e.locked) return { kind: "locked" };
  if (e.status === "PAST_DUE" && e.graceEndsAt) return { kind: "pastDue", graceEndsAt: e.graceEndsAt.toISOString() };
  const end = e.subscription?.currentPeriodEnd;
  if (e.status === "TRIALING" && end) return { kind: "trial", daysLeft: Math.max(0, Math.ceil((end.getTime() - now) / DAY)) };
  return null;
}

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const [session, brand] = await Promise.all([requireOrg(), getBranding()]);
  const ent = await getEntitlements(session.org.id);
  const notice: ShellNotice | null = session.impersonatorId
    ? { kind: "impersonating", name: session.user.name, email: session.user.email }
    : isDemo()
      ? { kind: "demo", hours: demoResetHours() }
      : billingNotice(ent);
  return (
    <AppShell
      brand={{ appName: brand.appName, logoUrl: brand.logoUrl }}
      user={{ name: session.user.name, email: session.user.email, isSuperAdmin: session.user.platformRole === "SUPER_ADMIN" }}
      org={{ id: session.org.id, name: session.org.name }}
      role={session.role}
      orgs={session.memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role }))}
      notice={notice}
    >
      {children}
    </AppShell>
  );
}
