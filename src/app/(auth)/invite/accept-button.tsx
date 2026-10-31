"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";

export function AcceptInviteButton({ token }: { token: string }) {
  const t = useTranslations("invite");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/team/invitations/accept", { body: { token } });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <FormMessage type="error">{error}</FormMessage>
      <Button onClick={accept} disabled={pending} className="w-full">
        {t("accept")}
      </Button>
    </div>
  );
}
