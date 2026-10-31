"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { FieldInput, fieldValuesFromForm } from "@/components/crm/field-input";
import type { ContactItem, FieldDefItem, Member } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";

/** New contact form */
export function ContactDialog({
  open,
  onOpenChange,
  fields,
  members,
  meId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldDefItem[];
  members: Member[];
  meId: string;
  onSaved: (contact: ContactItem) => void;
}) {
  const t = useTranslations("contacts");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const values = fieldValuesFromForm(f, fields);
    const body = {
      name: f.get("name") || null,
      phone: f.get("phone"),
      email: f.get("email") || null,
      ownerId: f.get("ownerId") || null,
      tags: String(f.get("tags") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      optedIn: f.get("optedIn") === "on",
      fields: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)),
    };
    setPending(true);
    const res = await apiFetch<{ contact: ContactItem }>("/api/contacts", { body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("created"));
    onOpenChange(false);
    onSaved(res.data!.contact);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
            <DialogDescription>{t("newText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label={t("name")} maxLength={100} autoFocus />
            <Field id="phone" label={t("phone")} required inputMode="tel" placeholder="+91 90000 12345" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="email" label={t("email")} type="email" maxLength={254} />
            <div className="grid gap-1.5">
              <Label htmlFor="ownerId">{t("owner")}</Label>
              <NativeSelect id="ownerId" name="ownerId" defaultValue={meId}>
                <option value="">{t("noOwner")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <Field id="tags" label={t("tags")} hint={t("tagsHint")} maxLength={500} />
          {fields.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((d) => (
                <div key={d.key} className="grid gap-1.5">
                  <Label htmlFor={`field-${d.key}`}>{d.label}</Label>
                  <FieldInput def={d} value={undefined} />
                </div>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="optedIn" className="mt-0.5 size-4 accent-primary" />
            <span>
              {t("optedInCheckbox")}
              <span className="block text-xs text-muted-foreground">{t("optedInHint")}</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
