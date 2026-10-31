import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FormMessage } from "@/components/forms";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";
import { AcceptInviteButton } from "./accept-button";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const t = await getTranslations("invite");
  const { token } = await searchParams;
  const invitation =
    typeof token === "string" && token
      ? await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { org: { select: { name: true } } } })
      : null;

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FormMessage type="error">{t("invalid")}</FormMessage>
        </CardContent>
      </Card>
    );
  }

  const session = await getSession();
  const here = `/invite?token=${encodeURIComponent(token as string)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("joinOrg", { org: invitation.org.name })}</CardTitle>
        <CardDescription>{t("details", { email: invitation.email, role: invitation.role.toLowerCase() })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {!session ? (
          <>
            <p className="text-sm text-muted-foreground">{t("signInFirst")}</p>
            <Link href={`/login?next=${encodeURIComponent(here)}`} className={buttonVariants({ className: "w-full" })}>
              {t("signIn")}
            </Link>
            <Link href="/register" className={buttonVariants({ variant: "outline", className: "w-full" })}>
              {t("createAccount")}
            </Link>
            <p className="text-xs text-muted-foreground">{t("afterRegister")}</p>
          </>
        ) : !session.user.emailVerifiedAt ? (
          <FormMessage type="error">{t("verifyFirst")}</FormMessage>
        ) : session.user.email !== invitation.email ? (
          <FormMessage type="error">{t("wrongAccount", { email: invitation.email })}</FormMessage>
        ) : (
          <AcceptInviteButton token={token as string} />
        )}
      </CardContent>
    </Card>
  );
}
