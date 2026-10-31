"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import type { InboxContext } from "./types";

export function NewChatDialog({
  open,
  onOpenChange,
  accounts,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: InboxContext["accounts"];
  onStarted: (conversationId: string) => void;
}) {
  const t = useTranslations("inbox");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await apiFetch<{ conversation: { id: string } }>("/api/inbox/conversations", {
      body: { accountId: f.get("accountId"), phone: f.get("phone"), name: f.get("contactName") || undefined },
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onStarted(res.data!.conversation.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("newChat")}</DialogTitle>
            <DialogDescription>{t("newChatText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-1.5">
            <Label htmlFor="accountId">{t("fromNumber")}</Label>
            <select id="accountId" name="accountId" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.phone ? ` (+${a.phone})` : ""}
                </option>
              ))}
            </select>
          </div>
          <Field id="phone" label={t("customerPhone")} placeholder="+91 90000 12345" required inputMode="tel" />
          <Field id="contactName" label={t("customerName")} maxLength={100} />
          <p className="text-xs text-muted-foreground">{t("newChatOfficialHint")}</p>
          <Button type="submit" disabled={pending}>
            {t("startChat")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
