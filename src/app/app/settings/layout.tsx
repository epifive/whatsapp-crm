import { getTranslations } from "next-intl/server";
import { getSession, roleAtLeast } from "@/lib/auth/session";
import { getBilling } from "@/lib/settings";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/app/settings">) {
  const t = await getTranslations("settings");
  const session = await getSession();
  const isAdmin = !!session?.role && roleAtLeast(session.role, "ADMIN");
  const billingEnabled = (await getBilling()).enabled;
  return (
    <div className="grid gap-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <SettingsTabs isAdmin={isAdmin} billingEnabled={billingEnabled} />
      {children}
    </div>
  );
}
