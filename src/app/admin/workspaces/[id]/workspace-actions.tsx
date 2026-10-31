"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";

interface Props {
  orgId: string;
  suspended: boolean;
  hasSubscription: boolean;
  hasOwner: boolean;
  plans: { id: string; name: string; isActive: boolean }[];
  current: { planId: string; interval: "MONTHLY" | "YEARLY"; periodEnd: string } | null;
}

export function WorkspaceActions({ orgId, suspended, hasSubscription, hasOwner, plans, current }: Props) {
  const t = useTranslations("adminWorkspaces");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await apiFetch(`/api/admin/workspaces/${orgId}`, { method: "PATCH", body });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    toast.success(done);
    router.refresh();
  }

  async function viewAs() {
    const res = await apiFetch<{ redirect: string }>(`/api/admin/workspaces/${orgId}/impersonate`, { body: {} });
    if (!res.ok) return toast.error(res.error);
    window.location.assign(res.data!.redirect);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("actions")}</CardTitle>
        <CardDescription>{t("actionsText")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <FormMessage type="error">{error}</FormMessage>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act({ action: "set_plan", planId: f.get("planId"), interval: f.get("interval"), periodEnd: f.get("periodEnd") || null }, t("planSet"));
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="planId">{t("setPlan")}</Label>
            <NativeSelect id="planId" name="planId" defaultValue={current?.planId ?? plans[0]?.id} required>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isActive ? "" : ` (${t("inactive")})`}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="interval">{t("interval")}</Label>
            <NativeSelect id="interval" name="interval" defaultValue={current?.interval ?? "MONTHLY"}>
              <option value="MONTHLY">{t("intervalName.MONTHLY")}</option>
              <option value="YEARLY">{t("intervalName.YEARLY")}</option>
            </NativeSelect>
          </div>
          <Field id="periodEnd" type="date" label={t("until")} defaultValue={current?.periodEnd ?? ""} hint={t("untilHint")} />
          <Button type="submit" disabled={busy || !plans.length}>
            {t("apply")}
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {hasSubscription && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "trial", trialEnd: new FormData(e.currentTarget).get("trialEnd") }, t("trialSet"));
              }}
            >
              <Field id="trialEnd" type="date" label={t("trialUntil")} required />
              <Button type="submit" variant="outline" disabled={busy}>
                {t("startTrial")}
              </Button>
            </form>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {hasOwner && (
            <Button variant="outline" onClick={() => void viewAs()}>
              <Eye />
              {t("viewAs")}
            </Button>
          )}
          {hasSubscription && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (confirm(t("confirmExpire"))) void act({ action: "expire" }, t("expired"));
              }}
            >
              {t("expireNow")}
            </Button>
          )}
          {suspended ? (
            <Button variant="outline" disabled={busy} onClick={() => void act({ action: "unsuspend" }, t("unsuspended"))}>
              {t("unsuspend")}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const reason = prompt(t("suspendReason"));
                if (reason !== null) void act({ action: "suspend", reason }, t("suspendedDone"));
              }}
            >
              {t("suspend")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
