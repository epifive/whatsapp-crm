"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Check, ChevronsUpDown, LogOut, Menu, Plus, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import { CrmNotifications } from "./crm-notifications";
import { APP_NAV } from "./nav";
import { NOTICE_HEIGHT, ShellNoticeBar, type ShellNotice } from "./shell-notice";

const ROLE_RANK = { AGENT: 1, ADMIN: 2, OWNER: 3 } as const;
type Role = keyof typeof ROLE_RANK;

export interface ShellProps {
  brand: { appName: string; logoUrl: string | null };
  user: { name: string; email: string; isSuperAdmin: boolean };
  org: { id: string; name: string };
  role: Role;
  orgs: { id: string; name: string; role: Role }[];
  notice?: ShellNotice | null;
  children: React.ReactNode;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav className="grid gap-1 p-3">
      {APP_NAV.filter((item) => !item.minRole || ROLE_RANK[role] >= ROLE_RANK[item.minRole]).map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ brand, user, org, role, orgs, notice, children }: ShellProps) {
  const t = useTranslations("shell");
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Full-screen workspaces (the inbox) manage their own layout and scrolling
  // The flow builder canvas is full-screen too (the list of flows is not)
  const fullBleed = pathname.startsWith("/app/inbox") || /^\/app\/automations\/[^/]+$/.test(pathname);
  // Wide boards (the deals Kanban) use the whole width instead of the reading column
  const wide = pathname.startsWith("/app/deals");

  async function switchOrg(orgId: string) {
    if (orgId === org.id) return;
    const res = await apiFetch("/api/orgs/switch", { body: { orgId } });
    if (res.ok) router.refresh();
  }

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST", body: {} });
    router.replace("/login");
    router.refresh();
  }

  const orgSwitcher = (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{org.name}</span>
          <span className="block text-xs text-muted-foreground">{t(`role.${role}`)}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("organizations")}</DropdownMenuLabel>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)}>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.id === org.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/onboarding?new=1")}>
          <Plus className="size-4" />
          {t("newOrganization")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/app" onClick={onNavigate}>
          <Brand appName={brand.appName} logoUrl={brand.logoUrl} />
        </Link>
      </div>
      <div className="border-b p-3">{orgSwitcher}</div>
      <div className="flex-1 overflow-y-auto">
        <SidebarNav role={role} onNavigate={onNavigate} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 border-e bg-background lg:block print:hidden">{sidebar()}</aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
          {sidebar(() => setMobileOpen(false))}
        </SheetContent>
      </Sheet>

      <CrmNotifications orgId={org.id} />
      <div className="lg:ps-64 print:ps-0" style={{ "--notice-h": notice ? NOTICE_HEIGHT : "0px" } as React.CSSProperties}>
        {notice && <ShellNoticeBar notice={notice} canManageBilling={ROLE_RANK[role] >= ROLE_RANK.ADMIN} />}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6 print:hidden">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("openMenu")}>
            <Menu className="size-5" />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium lg:hidden">{org.name}</div>
          <div className="ms-auto flex items-center gap-2">
            {user.isSuperAdmin && (
              <Link href="/admin" className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:flex">
                <ShieldCheck className="size-4" />
                {t("admin")}
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-full" aria-label={t("account")}>
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials(user.name)}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <span className="block truncate">{user.name}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {user.isSuperAdmin && (
                  <DropdownMenuItem onClick={() => router.push("/admin")} className="sm:hidden">
                    <ShieldCheck className="size-4" />
                    {t("admin")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={signOut}>
                  <LogOut className="size-4" />
                  {t("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {fullBleed ? (
          <main className="h-[calc(100dvh-3.5rem-var(--notice-h))]">{children}</main>
        ) : (
          <main className={cn("mx-auto w-full p-4 sm:p-6 lg:p-8 print:p-0", !wide && "max-w-6xl")}>{children}</main>
        )}
      </div>
    </div>
  );
}
