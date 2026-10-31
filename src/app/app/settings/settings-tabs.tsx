"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/settings/organization", key: "organization" },
  { href: "/app/settings/team", key: "team" },
  { href: "/app/settings/numbers", key: "numbers" },
  { href: "/app/settings/ai", key: "ai" },
  { href: "/app/settings/canned", key: "canned" },
  { href: "/app/settings/fields", key: "fields" },
  { href: "/app/settings/pipelines", key: "pipelines" },
  { href: "/app/settings/tags", key: "tags" },
  { href: "/app/settings/developers", key: "developers", adminOnly: true },
  { href: "/app/settings/billing", key: "billing", adminOnly: true, billing: true },
] as const;

export function SettingsTabs({ isAdmin, billingEnabled }: { isAdmin: boolean; billingEnabled: boolean }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // On narrow screens the tab bar scrolls; keep the current tab visible
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);
  return (
    <nav ref={nav} className="flex gap-1 relative overflow-x-auto border-b print:hidden">
      {TABS.filter((tab) => (isAdmin || !("adminOnly" in tab)) && (billingEnabled || !("billing" in tab))).map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
