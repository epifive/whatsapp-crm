"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Briefcase, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConsentBadge } from "../contacts-view";
import { DealDialog } from "@/components/crm/deal-dialog";
import { displayFieldValue, FieldInput, fieldValuesFromForm } from "@/components/crm/field-input";
import { formatMoney, initials } from "@/components/crm/format";
import { LocalTime } from "@/components/crm/local-time";
import { TaskDialog } from "@/components/crm/task-dialog";
import { TaskList } from "@/components/crm/task-list";
import { Timeline } from "@/components/crm/timeline";
import type { ContactItem, DealItem, FieldDefItem, Member, PipelineItem, TaskItem, TimelineEntry } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";

interface Detail {
  contact: ContactItem;
  conversations: { id: string; status: string; lastMessageAt: string | null; account: { id: string; name: string; channel: "OFFICIAL" | "QR" } }[];
  deals: DealItem[];
  tasks: TaskItem[];
}

interface Account {
  id: string;
  name: string;
  phone: string | null;
  channel: "OFFICIAL" | "QR";
  status: string;
}

export function ContactProfile({
  initial,
  initialTimeline,
  fields,
  members,
  accounts,
  pipelines,
  tagNames,
  currency,
  meId,
  isAdmin,
}: {
  initial: Detail;
  initialTimeline: { items: TimelineEntry[]; nextBefore: string | null };
  fields: FieldDefItem[];
  members: Member[];
  accounts: Account[];
  pipelines: PipelineItem[];
  tagNames: string[];
  currency: string;
  meId: string;
  isAdmin: boolean;
}) {
  const t = useTranslations("contacts");
  const tc = useTranslations("crm");
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [entries, setEntries] = useState(initialTimeline.items);
  const [nextBefore, setNextBefore] = useState(initialTimeline.nextBefore);
  const [editing, setEditing] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [task, setTask] = useState<TaskItem | "new" | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [now] = useState(() => Date.now());
  const c = detail.contact;
  const id = c.id;

  const reload = useCallback(async () => {
    const [d, tl] = await Promise.all([apiFetch<Detail>(`/api/contacts/${id}`), apiFetch<{ items: TimelineEntry[]; nextBefore: string | null }>(`/api/contacts/${id}/timeline`)]);
    if (d.status === 404) return router.replace("/app/contacts");
    if (d.ok && d.data) setDetail(d.data);
    if (tl.ok && tl.data) {
      setEntries(tl.data.items);
      setNextBefore(tl.data.nextBefore);
    }
  }, [id, router]);

  const refresh = useMemo(() => debounce(() => void reload(), 400), [reload]);
  useRealtime<{ contactId?: string }>("contact.updated", (ev) => ev.contactId === id && refresh());
  useRealtime<{ conversationId: string }>("message.created", (ev) => detail.conversations.some((cv) => cv.id === ev.conversationId) && refresh());
  useRealtime("deals.changed", refresh);
  useRealtime("tasks.changed", refresh);

  async function loadOlder() {
    if (!nextBefore) return;
    const res = await apiFetch<{ items: TimelineEntry[]; nextBefore: string | null }>(`/api/contacts/${id}/timeline?before=${encodeURIComponent(nextBefore)}`);
    if (!res.ok || !res.data) return;
    setEntries((prev) => [...prev, ...res.data!.items]);
    setNextBefore(res.data.nextBefore);
  }

  async function patch(body: Record<string, unknown>) {
    const res = await apiFetch<Detail>(`/api/contacts/${id}`, { method: "PATCH", body });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setDetail(res.data!);
    void reload();
    return true;
  }

  async function addTag(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("tag") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) return;
    const res = await apiFetch(`/api/contacts/${id}/tags`, { body: { name } });
    if (!res.ok) return toast.error(res.error);
    input.value = "";
    void reload();
  }

  async function removeTag(tagId: string) {
    const res = await apiFetch(`/api/contacts/${id}/tags?tagId=${tagId}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void reload();
  }

  async function remove() {
    if (!confirm(t("confirmDelete", { name: c.name }))) return;
    const res = await apiFetch(`/api/contacts/${id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("deleted"));
    router.replace("/app/contacts");
  }

  const filledFields = fields.filter((d) => c.fields[d.key] !== undefined && c.fields[d.key] !== "");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <Link href="/app/contacts" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("backToContacts")}>
          <ArrowLeft />
        </Link>
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{initials(c.name)}</div>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="tabular-nums">+{c.phone}</span>
            <ConsentBadge c={c} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setChatOpen(true)} disabled={accounts.length === 0}>
            <MessageSquare />
            {t("message")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDealOpen(true)}>
            <Briefcase />
            {tc("newDeal")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTask("new")}>
            <Plus />
            {tc("newTask")}
          </Button>
          {isAdmin && (
            <Button size="icon-sm" variant="ghost" onClick={remove} aria-label={t("delete")}>
              <Trash2 className="text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("details")}</CardTitle>
              <CardAction>
                {!editing && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                    {t("edit")}
                  </Button>
                )}
              </CardAction>
            </CardHeader>
            <CardContent>
              {editing ? (
                <DetailsForm
                  contact={c}
                  fields={fields}
                  members={members}
                  onCancel={() => setEditing(false)}
                  onSave={async (body) => {
                    if (await patch(body)) {
                      setEditing(false);
                      toast.success(t("saved"));
                    }
                  }}
                />
              ) : (
                <dl className="grid gap-3 text-sm">
                  <Row label={t("phone")} value={`+${c.phone}`} />
                  {c.waName && c.waName !== c.savedName && <Row label={t("whatsappName")} value={c.waName} />}
                  <Row label={t("email")} value={c.email} />
                  <Row label={t("owner")} value={c.owner?.name} />
                  {filledFields.map((d) => (
                    <Row key={d.key} label={d.label} value={displayFieldValue(d, c.fields[d.key], tc("yes"), tc("no"))} />
                  ))}
                  <Row label={t("source")} value={c.source ? t(`sources.${c.source}`) : null} />
                  <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">{t("added")}</dt>
                    <dd>
                      <LocalTime iso={c.createdAt} />
                    </dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("tags")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {c.tags.length === 0 && <span className="text-sm text-muted-foreground">{t("noTags")}</span>}
                {c.tags.map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
                    {tag.name}
                    <button type="button" onClick={() => removeTag(tag.id)} aria-label={t("removeTag", { tag: tag.name })} className="opacity-80 hover:opacity-100">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={addTag} className="flex gap-2">
                <Input name="tag" list="profile-tags" placeholder={t("tagPlaceholder")} maxLength={30} aria-label={t("addTag")} />
                <datalist id="profile-tags">
                  {tagNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <Button type="submit" variant="outline">
                  {t("add")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("consentTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {c.optedOut ? (
                <p>
                  {t("optedOutSince")} <LocalTime iso={c.optedOutAt} />
                </p>
              ) : c.optedInAt ? (
                <p>
                  {t("optedInSince")} <LocalTime iso={c.optedInAt} />
                  {c.optInSource ? ` · ${t(`sources.${c.optInSource}`)}` : ""}
                </p>
              ) : (
                <p className="text-muted-foreground">{t("consentUnknownText")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!c.optedOut && !c.optedInAt && (
                  <Button size="sm" variant="outline" onClick={() => void patch({ optedIn: true })}>
                    {t("recordOptIn")}
                  </Button>
                )}
                {!c.optedOut && (
                  <Button size="sm" variant="outline" onClick={() => void patch({ optedOut: true })}>
                    {t("markOptedOut")}
                  </Button>
                )}
                {c.optedOut && isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => confirm(t("confirmResubscribe")) && void patch({ optedOut: false })}>
                    {t("resubscribe")}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("conversations")}</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
              ) : (
                <ul className="grid gap-2">
                  {detail.conversations.map((cv) => (
                    <li key={cv.id}>
                      <Link href={`/app/inbox?c=${cv.id}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                        <MessageSquare className="size-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{cv.account.name}</span>
                        <span className="text-xs text-muted-foreground">{tc(`conversationStatus.${cv.status}`)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{tc("deals")}</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => setDealOpen(true)}>
                  <Plus />
                  {tc("newDeal")}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {detail.deals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc("noDeals")}</p>
              ) : (
                <ul className="divide-y">
                  {detail.deals.map((d) => (
                    <li key={d.id}>
                      <Link href={`/app/deals?pipeline=${d.pipelineId}&deal=${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm hover:underline-offset-2">
                        <span className="min-w-0 flex-1 truncate font-medium hover:underline">{d.title}</span>
                        <span className="rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: d.stage.color }}>
                          {d.stage.name}
                        </span>
                        <span className="tabular-nums">{formatMoney(d.value, d.currency)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tc("openTasks")}</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => setTask("new")}>
                  <Plus />
                  {tc("newTask")}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {detail.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc("noOpenTasks")}</p>
              ) : (
                <TaskList tasks={detail.tasks} now={now} onChanged={reload} onEdit={setTask} compact />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("history")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline entries={entries} notePath={`/api/contacts/${id}/notes`} onNoteAdded={reload} hasMore={!!nextBefore} onLoadMore={loadOlder} />
            </CardContent>
          </Card>
        </div>
      </div>

      {dealOpen && (
        <DealDialog
          open
          onOpenChange={setDealOpen}
          deal={null}
          pipelines={pipelines}
          members={members}
          meId={meId}
          currency={currency}
          contact={{ id: c.id, name: c.name, phone: c.phone }}
          onSaved={() => void reload()}
        />
      )}
      {task && (
        <TaskDialog
          key={task === "new" ? "new" : task.id}
          open
          onOpenChange={(o) => !o && setTask(null)}
          task={task === "new" ? null : task}
          members={members}
          meId={meId}
          contact={{ id: c.id, name: c.name, phone: c.phone }}
          onSaved={() => void reload()}
        />
      )}
      <StartChatDialog open={chatOpen} onOpenChange={setChatOpen} accounts={accounts} contact={c} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function DetailsForm({
  contact,
  fields,
  members,
  onSave,
  onCancel,
}: {
  contact: ContactItem;
  fields: FieldDefItem[];
  members: Member[];
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("contacts");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    await onSave({
      name: f.get("name") || null,
      phone: f.get("phone"),
      email: f.get("email") || null,
      ownerId: f.get("ownerId") || null,
      fields: fieldValuesFromForm(f, fields),
    });
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field id="name" label={t("name")} defaultValue={contact.savedName ?? ""} maxLength={100} placeholder={contact.waName ?? ""} />
      <Field id="phone" label={t("phone")} defaultValue={`+${contact.phone}`} required inputMode="tel" />
      <Field id="email" label={t("email")} type="email" defaultValue={contact.email ?? ""} maxLength={254} />
      <div className="grid gap-1.5">
        <Label htmlFor="ownerId">{t("owner")}</Label>
        <NativeSelect id="ownerId" name="ownerId" defaultValue={contact.owner?.id ?? ""}>
          <option value="">{t("noOwner")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {fields.map((d) => (
        <div key={d.key} className="grid gap-1.5">
          <Label htmlFor={`field-${d.key}`}>{d.label}</Label>
          <FieldInput def={d} value={contact.fields[d.key]} />
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Opens (or creates) the chat with this contact on one of the workspace's numbers */
function StartChatDialog({
  open,
  onOpenChange,
  accounts,
  contact,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: Account[];
  contact: ContactItem;
}) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const accountId = new FormData(e.currentTarget).get("accountId");
    setPending(true);
    const res = await apiFetch<{ conversation: { id: string } }>("/api/inbox/conversations", { body: { accountId, phone: `+${contact.phone}` } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push(`/app/inbox?c=${res.data!.conversation.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("messageTitle", { name: contact.name })}</DialogTitle>
            <DialogDescription>{t("messageText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-1.5">
            <Label htmlFor="accountId">{t("fromNumber")}</Label>
            <NativeSelect id="accountId" name="accountId">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.phone ? ` (+${a.phone})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          {contact.optedOut && <p className="text-sm text-destructive">{t("optedOutWarning")}</p>}
          <Button type="submit" disabled={pending}>
            {t("openChat")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
