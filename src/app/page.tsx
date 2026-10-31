import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bot, Check, Inbox, Megaphone, Sparkles, Users } from "lucide-react";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/billing/money";
import { FEATURE_KEYS, LIMIT_KEYS, UNLIMITED, readFeatures, readLimits } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { getBilling, getBranding } from "@/lib/settings";
import { cn } from "@/lib/utils";

// Public landing page with the plans from Admin › Plans when billing is on
export default async function HomePage() {
  const [t, b, brand, billing] = await Promise.all([getTranslations("home"), getTranslations("billing"), getBranding(), getBilling()]);
  const plans = billing.enabled ? await db.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] }) : [];
  const features = [
    { icon: Inbox, title: t("featureInbox"), text: t("featureInboxText") },
    { icon: Users, title: t("featureCrm"), text: t("featureCrmText") },
    { icon: Megaphone, title: t("featureCampaigns"), text: t("featureCampaignsText") },
    { icon: Bot, title: t("featureBots"), text: t("featureBotsText") },
    { icon: Sparkles, title: t("featureAi"), text: t("featureAiText") },
  ];
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand appName={brand.appName} logoUrl={brand.logoUrl} className="min-w-0" />
        <nav className="ms-auto flex items-center gap-2">
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
            {t("signIn")}
          </Link>
          <Link href="/register" className={buttonVariants()}>
            {t("getStarted")}
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <section className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("heading")}</h1>
          <p className="mt-5 text-lg text-muted-foreground">{t("subheading")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/register" className={buttonVariants({ size: "lg" })}>
              {t("getStarted")}
            </Link>
            <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
              {t("signIn")}
            </Link>
          </div>
        </section>
        <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border p-6">
              <Icon className="size-6 text-primary" />
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
        {plans.length > 0 && (
          <section id="pricing" className="mt-24">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-bold tracking-tight">{t("pricing")}</h2>
              <p className="mt-3 text-muted-foreground">{t("pricingText")}</p>
            </div>
            <div className={cn("mt-10 grid gap-4 sm:grid-cols-2", plans.length >= 3 && "lg:grid-cols-3", plans.length >= 4 && "xl:grid-cols-4")}>
              {plans.map((p) => {
                const limits = readLimits(p.limits);
                const features = readFeatures(p.features);
                const free = p.priceMonthly === 0 && p.priceYearly === 0;
                return (
                  <div key={p.id} className="flex flex-col rounded-xl border p-6">
                    <h3 className="font-semibold">{p.name}</h3>
                    {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                    <div className="mt-4">
                      {free ? (
                        <span className="text-3xl font-bold">{b("free")}</span>
                      ) : p.priceMonthly > 0 ? (
                        <>
                          <span className="text-3xl font-bold">{formatMoney(p.priceMonthly, billing.currency)}</span>
                          <span className="text-sm text-muted-foreground"> / {b("per.MONTHLY")}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-3xl font-bold">{formatMoney(p.priceYearly, billing.currency)}</span>
                          <span className="text-sm text-muted-foreground"> / {b("per.YEARLY")}</span>
                        </>
                      )}
                      {p.priceMonthly > 0 && p.priceYearly > 0 && (
                        <div className="text-xs text-muted-foreground">{t("orYearly", { price: formatMoney(p.priceYearly, billing.currency) })}</div>
                      )}
                    </div>
                    <ul className="mt-5 grid flex-1 gap-1.5 text-sm">
                      {LIMIT_KEYS.map((k) => (
                        <li key={k} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          {limits[k] === UNLIMITED ? b(`planLimitUnlimited.${k}`) : b(`planLimit.${k}`, { n: limits[k] })}
                        </li>
                      ))}
                      {FEATURE_KEYS.filter((f) => features[f]).map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          {b(`feature.${f}`)}
                        </li>
                      ))}
                    </ul>
                    <Link href="/register" className={cn(buttonVariants({ variant: free ? "outline" : "default" }), "mt-6")}>
                      {p.trialDays > 0 && !free ? t("startTrial", { days: p.trialDays }) : t("getStarted")}
                    </Link>
                  </div>
                );
              })}
            </div>
            {billing.taxPercent > 0 && <p className="mt-4 text-center text-xs text-muted-foreground">{t("pricesExclTax", { tax: billing.taxName })}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
