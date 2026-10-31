"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { FormMessage } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";

/** Opened from the email link: confirms the token once, then sends the user onwards */
export function ConfirmToken({ token, signedIn }: { token: string; signedIn: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [state, setState] = useState<"pending" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React dev mode runs effects twice; tokens are single-use
    started.current = true;
    apiFetch("/api/auth/verify-email", { body: { token } }).then((res) => {
      if (!res.ok) {
        setError(res.error);
        setState("error");
        return;
      }
      setState("done");
      if (signedIn) {
        router.replace("/app");
        router.refresh();
      }
    });
  }, [token, signedIn, router]);

  if (state === "pending") return <p className="text-sm text-muted-foreground">{t("verifying")}</p>;
  if (state === "error") return <FormMessage type="error">{error}</FormMessage>;
  return (
    <div className="grid gap-4">
      <FormMessage type="success">{t("verified")}</FormMessage>
      {!signedIn && (
        <Link href="/login" className={buttonVariants({ className: "w-full" })}>
          {t("signIn")}
        </Link>
      )}
    </div>
  );
}

export function ResendButton() {
  const t = useTranslations("auth");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    setPending(true);
    const res = await apiFetch("/api/auth/resend-verification", { method: "POST", body: {} });
    setPending(false);
    setMessage(res.ok ? { type: "success", text: t("verificationResent") } : { type: "error", text: res.error ?? "" });
  }

  return (
    <div className="grid gap-3">
      {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
      <Button variant="outline" onClick={resend} disabled={pending}>
        {t("resendEmail")}
      </Button>
    </div>
  );
}

export function SignOutLink() {
  const t = useTranslations("auth");
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonVariants({ variant: "link", className: "text-muted-foreground" })}
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST", body: {} });
        router.replace("/login");
        router.refresh();
      }}
    >
      {t("useAnotherAccount")}
    </button>
  );
}
