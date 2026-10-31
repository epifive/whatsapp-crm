"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", key: "overview" },
  { href: "/admin/workspaces", key: "workspaces" },
  { href: "/admin/plans", key: "plans" },
  { href: "/admin/coupons", key: "coupons" },
  { href: "/admin/invoices", key: "invoices" },
  { href: "/admin/settings", key: "settings" },
] as const;

export function AdminNav() {
  const t = useTranslations("admin");
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-1 relative overflow-x-auto">
      {ITEMS.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
