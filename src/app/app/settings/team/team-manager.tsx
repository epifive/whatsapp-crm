"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { MailPlus, Trash2 } from "lucide-react";
import { FormMessage } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";

type Role = "OWNER" | "ADMIN" | "AGENT";
const ROLES: Role[] = ["OWNER", "ADMIN", "AGENT"];
const RANK: Record<Role, number> = { AGENT: 1, ADMIN: 2, OWNER: 3 };

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
}
interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

// Mirrors canManageMember in src/lib/orgs.ts (the server enforces it; this only hides controls)
function canManage(actor: Role, target: Role) {
  return actor === "OWNER" || (actor === "ADMIN" && target === "AGENT");
}

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export function TeamManager({
  currentUserId,
  currentRole,
  members,
  invitations,
}: {
  currentUserId: string;
  currentRole: Role;
  members: Member[];
  invitations: Invitation[];
}) {
  const t = useTranslations("team");
  const tr = useTranslations("shell.role");
  const router = useRouter();
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isManager = RANK[currentRole] >= RANK.ADMIN;
  const invitableRoles = ROLES.filter((r) => currentRole === "OWNER" || r !== "OWNER");

  async function invite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setPending(true);
    setInviteError(null);
    const res = await apiFetch("/api/team/invitations", { body: { email: form.get("inviteEmail"), role: form.get("inviteRole") } });
    setPending(false);
    if (!res.ok) return setInviteError(res.error);
    toast.success(t("inviteSent"));
    formEl.reset();
    router.refresh();
  }

  async function act(path: string, method: string, body?: unknown, success?: string) {
    const res = await apiFetch(path, { method, body: body ?? {} });
    if (!res.ok) return toast.error(res.error);
    if (success) toast.success(success);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      {isManager && (
        <Card>
          <CardHeader>
            <CardTitle>{t("inviteTitle")}</CardTitle>
            <CardDescription>{t("inviteText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="inviteEmail">{t("email")}</Label>
                <Input id="inviteEmail" name="inviteEmail" type="email" required placeholder="agent@company.com" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inviteRole">{t("role")}</Label>
                <select id="inviteRole" name="inviteRole" defaultValue="AGENT" className={selectClass}>
                  {invitableRoles.map((r) => (
                    <option key={r} value={r}>
                      {tr(r)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={pending}>
                <MailPlus className="size-4" />
                {t("sendInvite")}
              </Button>
            </form>
            <div className="mt-3">
              <FormMessage type="error">{inviteError}</FormMessage>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("membersTitle", { count: members.length })}</CardTitle>
          <CardDescription>{t("rolesText")}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {members.map((m) => {
            const self = m.userId === currentUserId;
            const manageable = !self && canManage(currentRole, m.role);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {m.name} {self && <span className="text-muted-foreground">({t("you")})</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                {manageable ? (
                  <select
                    aria-label={t("roleFor", { name: m.name })}
                    defaultValue={m.role}
                    className={selectClass}
                    onChange={(e) => act(`/api/team/members/${m.id}`, "PATCH", { role: e.target.value }, t("roleUpdated"))}
                  >
                    {ROLES.filter((r) => currentRole === "OWNER" || r !== "OWNER").map((r) => (
                      <option key={r} value={r}>
                        {tr(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">{tr(m.role)}</Badge>
                )}
                {(manageable || self) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={self ? t("leave") : t("remove", { name: m.name })}
                    onClick={() => {
                      if (confirm(self ? t("confirmLeave") : t("confirmRemove", { name: m.name }))) {
                        act(`/api/team/members/${m.id}`, "DELETE", undefined, self ? t("left") : t("removed"));
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {isManager && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pendingTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {invitations.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.email}</div>
                  <div className="text-xs text-muted-foreground">{t("expires", { date: new Date(i.expiresAt).toLocaleDateString() })}</div>
                </div>
                <Badge variant="outline">{tr(i.role)}</Badge>
                <Button variant="ghost" size="sm" onClick={() => act(`/api/team/invitations/${i.id}`, "DELETE", undefined, t("revoked"))}>
                  {t("revoke")}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
