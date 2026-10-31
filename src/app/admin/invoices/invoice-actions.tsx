"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";

export function InvoiceActions({ invoiceId, number }: { invoiceId: string; number: string }) {
  const t = useTranslations("adminInvoices");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(action: "mark-paid" | "void") {
    if (!confirm(action === "mark-paid" ? t("confirmPaid", { number }) : t("confirmVoid", { number }))) return;
    setBusy(true);
    const res = await apiFetch(`/api/admin/invoices/${invoiceId}/${action}`, { body: {} });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(action === "mark-paid" ? t("markedPaid") : t("voided"));
    router.refresh();
  }
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" disabled={busy} onClick={() => void run("mark-paid")}>
        {t("markPaid")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("void")}>
        {t("void")}
      </Button>
    </div>
  );
}
