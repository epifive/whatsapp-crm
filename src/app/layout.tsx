import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RTL_LOCALES } from "@/i18n/config";
import { getBranding } from "@/lib/settings";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBranding().catch(() => null);
  const appName = brand?.appName ?? "CRM for WhatsApp";
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: "WhatsApp CRM: team inbox, contacts, campaigns, chatbots and AI.",
    // White-label favicon from Admin › Settings (falls back to /favicon.ico)
    ...(brand?.faviconUrl ? { icons: { icon: brand.faviconUrl } } : {}),
  };
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, brand] = await Promise.all([getLocale(), getBranding().catch(() => null)]);
  // Branding color from Admin > Settings (validated hex, so safe to inline)
  const color = brand && HEX_COLOR.test(brand.primaryColor) ? brand.primaryColor : null;
  return (
    <html lang={locale} dir={RTL_LOCALES.includes(locale) ? "rtl" : "ltr"} className="h-full antialiased" suppressHydrationWarning>
      <head>
        {color && <style>{`:root{--primary:${color};--ring:${color};--sidebar-primary:${color}}`}</style>}
      </head>
      <body className="min-h-full">
        <NextIntlClientProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
