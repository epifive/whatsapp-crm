"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Filter, Plus, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { ContactDialog } from "./contact-dialog";
import { LocalTime } from "@/components/crm/local-time";
import type { ContactItem, FieldDefItem, Member, TagItem } from "@/components/crm/types";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

type Consent = "" | "opted_in" | "opted_out" | "unknown";
type BulkAction = "add_tag" | "remove_tag" | "set_owner" | "opt_in" | "opt_out" | "delete";

export function ConsentBadge({ c }: { c: Pick<ContactItem, "optedOut" | "optedInAt"> }) {
  const t = useTranslations("contacts");
  if (c.optedOut) return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">{t("consent.opted_out")}</span>;
  if (c.optedInAt) return <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">{t("consent.opted_in")}</span>;
  return <span className="text-xs text-muted-foreground">{t("consent.unknown")}</span>;
}

export function TagChips({ tags, max = 3 }: { tags: TagItem[]; max?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((tag) => (
        <span key={tag.id} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ backgroundColor: tag.color }}>
          {tag.name}
        </span>
      ))}
      {tags.length > max && <span className="text-[11px] text-muted-foreground">+{tags.length - max}</span>}
    </div>
  );
}

export function ContactsView({
  tags,
  segments,
  members,
  fields,
  meId,
  isAdmin,
  initialSegmentId,
  initialTagId,
}: {
  tags: TagItem[];
  segments: { id: string; name: string }[];
  members: Member[];
  fields: FieldDefItem[];
  meId: string;
  isAdmin: boolean;
  initialSegmentId: string;
  initialTagId: string;
}) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tagId, setTagId] = useState(initialTagId);
  const [segmentId, setSegmentId] = useState(initialSegmentId);
  const [consent, setConsent] = useState<Consent>("");
  const [ownerId, setOwnerId] = useState("");
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [showFilters, setShowFilters] = useState(!!(initialSegmentId || initialTagId));

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (tagId) p.set("tagId", tagId);
    if (segmentId) p.set("segmentId", segmentId);
    if (consent) p.set("consent", consent);
    if (ownerId) p.set("ownerId", ownerId);
    return p;
  }, [q, tagId, segmentId, consent, ownerId]);
  const queryString = query.toString();

  const load = useCallback(async () => {
    const res = await apiFetch<{ contacts: ContactItem[]; total: number; nextCursor: string | null }>(`/api/contacts?${queryString}`);
    setLoading(false);
    if (!res.ok || !res.data) return setError(res.error);
    setError(null);
    setContacts(res.data.contacts);
    setTotal(res.data.total);
    setNextCursor(res.data.nextCursor);
  }, [queryString]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSelected(new Set());
      setAllMatching(false);
      void load();
    }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  const refresh = useMemo(() => debounce(() => void load(), 500), [load]);
  useRealtime("contacts.changed", refresh);
  useRealtime("contact.updated", refresh);

  async function loadMore() {
    if (!nextCursor) return;
    const res = await apiFetch<{ contacts: ContactItem[]; nextCursor: string | null }>(`/api/contacts?${queryString}&cursor=${nextCursor}`);
    if (!res.ok || !res.data) return;
    setContacts((prev) => [...prev, ...res.data!.contacts.filter((c) => !prev.some((p) => p.id === c.id))]);
    setNextCursor(res.data.nextCursor);
  }

  const pageIds = contacts.map((c) => c.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectionCount = allMatching ? total : selected.size;
  const filtersActive = !!(tagId || segmentId || consent || ownerId);

  function toggle(id: string, on: boolean) {
    setAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runBulk(action: BulkAction, extra: { tag?: string; ownerId?: string | null } = {}): Promise<void> {
    const target = allMatching ? { query: Object.fromEntries(query) } : { ids: [...selected] };
    const res = await apiFetch<{ affected: number }>("/api/contacts/bulk", { body: { action, ...target, ...extra } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(t("bulkDone", { count: res.data!.affected }));
    setBulk(null);
    setSelected(new Set());
    setAllMatching(false);
    if (extra.tag) router.refresh(); // new tags appear in the filter
    void load();
  }

  function confirmBulk(action: BulkAction) {
    if (action === "delete" && !confirm(t("confirmBulkDelete", { count: selectionCount }))) return;
    if (action === "opt_in" && !confirm(t("confirmBulkOptIn", { count: selectionCount }))) return;
    void runBulk(action);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{loading ? t("loading") : t("count", { count: total })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/contacts/segments" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Filter />
            {t("segments")}
          </Link>
          {isAdmin && (
            <>
              <Link href="/app/contacts/import" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Upload />
                {t("import")}
              </Link>
              <a href={`/api/contacts/export?${queryString}`} className={buttonVariants({ variant: "outline", size: "sm" })} download>
                <Download />
                {t("export")}
              </a>
            </>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t("new")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-8" aria-label={t("search")} />
        </div>
        <Button variant={filtersActive ? "secondary" : "outline"} size="sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          <Filter />
          {t("filters")}
        </Button>
      </div>
      {showFilters && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <NativeSelect aria-label={t("segment")} value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
            <option value="">{t("anySegment")}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("tag")} value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">{t("anyTag")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("consentLabel")} value={consent} onChange={(e) => setConsent(e.target.value as Consent)}>
            <option value="">{t("anyConsent")}</option>
            <option value="opted_in">{t("consent.opted_in")}</option>
            <option value="unknown">{t("consent.unknown")}</option>
            <option value="opted_out">{t("consent.opted_out")}</option>
          </NativeSelect>
          <NativeSelect aria-label={t("owner")} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">{t("anyOwner")}</option>
            <option value={meId}>{t("ownedByMe")}</option>
            <option value="none">{t("noOwner")}</option>
            {members
              .filter((m) => m.id !== meId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </NativeSelect>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setTagId("");
                setSegmentId("");
                setConsent("");
                setOwnerId("");
              }}
            >
              <X />
              {t("clearFilters")}
            </Button>
          )}
        </div>
      )}

      {selectionCount > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-sm">
          <span className="px-1 text-sm font-medium">{t("selected", { count: selectionCount })}</span>
          {pageAllSelected && !allMatching && total > contacts.length && (
            <Button variant="link" size="sm" onClick={() => setAllMatching(true)}>
              {t("selectAllMatching", { count: total })}
            </Button>
          )}
          <div className="ms-auto flex flex-wrap gap-1">
            <Button variant="outline" size="sm" onClick={() => setBulk("add_tag")}>
              {t("bulk.add_tag")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulk("remove_tag")}>
              {t("bulk.remove_tag")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulk("set_owner")}>
              {t("bulk.set_owner")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => confirmBulk("opt_out")}>
              {t("bulk.opt_out")}
            </Button>
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={() => confirmBulk("opt_in")}>
                  {t("bulk.opt_in")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => confirmBulk("delete")}>
                  {t("bulk.delete")}
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon-sm" aria-label={t("clearSelection")} onClick={() => (setSelected(new Set()), setAllMatching(false))}>
              <X />
            </Button>
          </div>
        </div>
      )}

      <Card className="py-0">
        <CardContent className="px-0">
          {error && <p className="p-6 text-center text-sm text-destructive">{error}</p>}
          {!error && !loading && contacts.length === 0 && (
            <div className="grid justify-items-center gap-3 p-10 text-center text-sm text-muted-foreground">
              {q || filtersActive ? t("noMatches") : t("empty")}
              {!q && !filtersActive && isAdmin && (
                <Link href="/app/contacts/import" className={buttonVariants({ size: "sm" })}>
                  <Upload />
                  {t("importFirst")}
                </Link>
              )}
            </div>
          )}
          {contacts.length > 0 && (
            <>
              {/* Table on wide screens */}
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 py-2.5 ps-4">
                      <Checkbox
                        checked={pageAllSelected}
                        onCheckedChange={(v) => {
                          setAllMatching(false);
                          setSelected(v ? new Set(pageIds) : new Set());
                        }}
                        aria-label={t("selectPage")}
                      />
                    </th>
                    <th className="py-2.5 font-medium">{t("name")}</th>
                    <th className="py-2.5 font-medium">{t("phone")}</th>
                    <th className="py-2.5 font-medium">{t("tags")}</th>
                    <th className="hidden py-2.5 font-medium lg:table-cell">{t("owner")}</th>
                    <th className="py-2.5 font-medium">{t("consentLabel")}</th>
                    <th className="hidden py-2.5 pe-4 font-medium xl:table-cell">{t("added")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contacts.map((c) => (
                    <tr key={c.id} className={cn("hover:bg-muted/50", (allMatching || selected.has(c.id)) && "bg-primary/5")}>
                      <td className="py-2.5 ps-4">
                        <Checkbox checked={allMatching || selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={t("selectContact", { name: c.name })} />
                      </td>
                      <td className="max-w-56 py-2.5">
                        <Link href={`/app/contacts/${c.id}`} className="block truncate font-medium hover:underline">
                          {c.name}
                        </Link>
                        {c.email && <div className="truncate text-xs text-muted-foreground">{c.email}</div>}
                      </td>
                      <td className="py-2.5 whitespace-nowrap tabular-nums">+{c.phone}</td>
                      <td className="max-w-48 py-2.5">
                        <TagChips tags={c.tags} />
                      </td>
                      <td className="hidden py-2.5 lg:table-cell">{c.owner?.name ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-2.5">
                        <ConsentBadge c={c} />
                      </td>
                      <td className="hidden py-2.5 pe-4 text-muted-foreground xl:table-cell">
                        <LocalTime iso={c.createdAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Cards on phones */}
              <ul className="divide-y md:hidden">
                {contacts.map((c) => (
                  <li key={c.id} className={cn("flex items-start gap-3 px-4 py-3", (allMatching || selected.has(c.id)) && "bg-primary/5")}>
                    <Checkbox className="mt-1" checked={allMatching || selected.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} aria-label={t("selectContact", { name: c.name })} />
                    <Link href={`/app/contacts/${c.id}`} className="grid min-w-0 flex-1 gap-1">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">+{c.phone}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <ConsentBadge c={c} />
                        <TagChips tags={c.tags} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      {nextCursor && (
        <Button variant="outline" className="justify-self-center" onClick={loadMore}>
          {t("loadMore")}
        </Button>
      )}

      {creating && (
        <ContactDialog
          open
          onOpenChange={setCreating}
          fields={fields}
          members={members}
          meId={meId}
          onSaved={(c) => router.push(`/app/contacts/${c.id}`)}
        />
      )}

      <BulkDialog action={bulk} tags={tags} members={members} count={selectionCount} onClose={() => setBulk(null)} onRun={runBulk} />
    </div>
  );
}

function BulkDialog({
  action,
  tags,
  members,
  count,
  onClose,
  onRun,
}: {
  action: BulkAction | null;
  tags: TagItem[];
  members: Member[];
  count: number;
  onClose: () => void;
  onRun: (action: BulkAction, extra: { tag?: string; ownerId?: string | null }) => Promise<void>;
}) {
  const t = useTranslations("contacts");
  const [pending, setPending] = useState(false);
  const open = action === "add_tag" || action === "remove_tag" || action === "set_owner";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    if (action === "set_owner") await onRun(action, { ownerId: (f.get("ownerId") as string) || null });
    else await onRun(action!, { tag: String(f.get("tag") ?? "").trim() });
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" key={action ?? "none"}>
          <DialogHeader>
            <DialogTitle>{action ? t(`bulk.${action}`) : ""}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("bulkAppliesTo", { count })}</p>
          {action === "set_owner" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ownerId">{t("owner")}</Label>
              <NativeSelect id="ownerId" name="ownerId">
                <option value="">{t("noOwner")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-tag">{t("tag")}</Label>
              {action === "remove_tag" ? (
                <NativeSelect id="bulk-tag" name="tag" required>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <>
                  <Input id="bulk-tag" name="tag" list="bulk-tag-list" required maxLength={30} placeholder={t("tagPlaceholder")} autoFocus />
                  <datalist id="bulk-tag-list">
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.name} />
                    ))}
                  </datalist>
                </>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("apply")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
