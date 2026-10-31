import { Bot, Briefcase, FileText, Inbox, LayoutDashboard, ListTodo, Megaphone, Settings, Users, type LucideIcon } from "lucide-react";
import type { OrgRole } from "@/generated/prisma/client";

export interface NavItem {
  href: string;
  labelKey: string; // key in the "nav" messages namespace
  icon: LucideIcon;
  minRole?: OrgRole;
}

// Sidebar items. New modules (inbox, contacts, campaigns, flows, AI) are added here as they ship.
export const APP_NAV: NavItem[] = [
  { href: "/app", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/app/inbox", labelKey: "inbox", icon: Inbox },
  { href: "/app/contacts", labelKey: "contacts", icon: Users },
  { href: "/app/deals", labelKey: "deals", icon: Briefcase },
  { href: "/app/tasks", labelKey: "tasks", icon: ListTodo },
  { href: "/app/campaigns", labelKey: "campaigns", icon: Megaphone },
  { href: "/app/templates", labelKey: "templates", icon: FileText },
  { href: "/app/automations", labelKey: "automations", icon: Bot },
  { href: "/app/settings", labelKey: "settings", icon: Settings },
];
