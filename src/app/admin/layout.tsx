import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { requireSuperAdmin } from "@/lib/auth/session";
import { ShellNoticeBar } from "@/components/app-shell/shell-notice";
import { demoResetHours, isDemo } from "@/lib/demo/mode";
import { getBranding } from "@/lib/settings";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireSuperAdmin();
  const [t, brand] = await Promise.all([getTranslations("admin"), getBranding()]);
  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      {isDemo() && <ShellNoticeBar notice={{ kind: "demo", hours: demoResetHours() }} canManageBilling={false} />}
      <header className="sticky top-0 z-20 border-b bg-background print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Brand appName={brand.appName} logoUrl={brand.logoUrl} className="min-w-0" />
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t("badge")}</span>
          <Link href="/app" className="ms-auto flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">{t("backToApp")}</span>
          </Link>
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <AdminNav />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8 print:p-0">{children}</main>
    </div>
  );
}
