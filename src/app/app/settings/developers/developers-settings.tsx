"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Copy, KeyRound, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { LocalTime } from "@/components/crm/local-time";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
}

interface Delivery {
  id: string;
  event: string;
  ok: boolean;
  status: number | null;
  attempt: number;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

interface Data {
  keys: ApiKeyRow[];
  webhooks: WebhookRow[];
  events: string[];
  flowSigningSecret: string;
}

function CopyField({ value, label }: { value: string; label: string }) {
  const t = useTranslations("developers");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t("copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

export function DevelopersSettings({ baseUrl }: { baseUrl: string }) {
  const t = useTranslations("developers");
  const [data, setData] = useState<Data | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [webhookForm, setWebhookForm] = useState<WebhookRow | "new" | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch<Data>("/api/developers");
    if (res.ok) setData(res.data);
  }, []);
  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function revoke(k: ApiKeyRow) {
    if (!confirm(t("confirmRevoke", { name: k.name }))) return;
    const res = await apiFetch(`/api/developers/keys/${k.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  async function patchWebhook(w: WebhookRow, body: Record<string, unknown>) {
    const res = await apiFetch<{ ok: boolean; secret?: string | null; status?: number | null; error?: string | null }>(`/api/developers/webhooks/${w.id}`, { method: "PATCH", body });
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    void load();
    return res.data;
  }

  async function removeWebhook(w: WebhookRow) {
    if (!confirm(t("confirmDeleteWebhook", { url: w.url }))) return;
    const res = await apiFetch(`/api/developers/webhooks/${w.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  if (!data) return <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t("apiKeys")}
          </CardTitle>
          <CardDescription>{t("apiKeysText")}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setCreatingKey(true)}>
              <Plus />
              {t("newKey")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="divide-y">
          {data.keys.length === 0 && <p className="py-3 text-sm text-muted-foreground">{t("noKeys")}</p>}
          {data.keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1 basis-40">
                <div className="font-medium">{k.name}</div>
                <div className="text-xs text-muted-foreground">
                  <code>{k.prefix}…</code> ·{" "}
                  {k.lastUsedAt ? (
                    <>
                      {t("lastUsed")} <LocalTime iso={k.lastUsedAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    </>
                  ) : (
                    t("neverUsed")
                  )}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke(k)}>
                {t("revoke")}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-4" />
            {t("webhooks")}
          </CardTitle>
          <CardDescription>{t("webhooksText")}</CardDescription>
          <CardAction>
            <Button size="sm" onClick={() => setWebhookForm("new")}>
              <Plus />
              {t("addWebhook")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.webhooks.length === 0 && <p className="text-sm text-muted-foreground">{t("noWebhooks")}</p>}
          {data.webhooks.map((w) => (
            <WebhookCard
              key={w.id}
              w={w}
              onToggle={(on) => void patchWebhook(w, { isActive: on })}
              onEdit={() => setWebhookForm(w)}
              onDelete={() => void removeWebhook(w)}
              onTest={async () => {
                const r = await patchWebhook(w, { test: true });
                if (!r) return;
                if (r.ok) toast.success(t("testOk", { status: r.status ?? 0 }));
                else toast.error(t("testFailed", { error: r.error ?? `HTTP ${r.status}` }));
              }}
              onRotate={async () => {
                if (!confirm(t("confirmRotate"))) return;
                const r = await patchWebhook(w, { rotateSecret: true });
                if (r?.secret) setNewSecret(r.secret);
              }}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("flowSecret")}</CardTitle>
          <CardDescription>{t("flowSecretText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyField value={data.flowSigningSecret} label={t("flowSecret")} />
        </CardContent>
      </Card>

      <ApiReference baseUrl={baseUrl} events={data.events} />

      {creatingKey && (
        <NewKeyDialog
          onClose={() => setCreatingKey(false)}
          onCreated={(key) => {
            setCreatingKey(false);
            setNewKey(key);
            void load();
          }}
        />
      )}
      {webhookForm && (
        <WebhookDialog
          webhook={webhookForm === "new" ? null : webhookForm}
          events={data.events}
          onClose={() => setWebhookForm(null)}
          onSaved={(secret) => {
            setWebhookForm(null);
            if (secret) setNewSecret(secret);
            void load();
          }}
        />
      )}
      <Dialog open={!!(newKey || newSecret)} onOpenChange={(o) => !o && (setNewKey(null), setNewSecret(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newKey ? t("keyCreated") : t("secretTitle")}</DialogTitle>
            <DialogDescription>{t("showOnce")}</DialogDescription>
          </DialogHeader>
          <CopyField value={newKey ?? newSecret ?? ""} label={newKey ? t("apiKey") : t("signingSecret")} />
          <Button onClick={() => (setNewKey(null), setNewSecret(null))}>{t("done")}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebhookCard({ w, onToggle, onEdit, onDelete, onTest, onRotate }: { w: WebhookRow; onToggle: (on: boolean) => void; onEdit: () => void; onDelete: () => void; onTest: () => void; onRotate: () => void }) {
  const t = useTranslations("developers");
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  async function toggleLog() {
    setOpen((o) => !o);
    if (!deliveries) {
      const res = await apiFetch<{ deliveries: Delivery[] }>(`/api/developers/webhooks/${w.id}`);
      setDeliveries(res.data?.deliveries ?? []);
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Switch checked={w.isActive} onCheckedChange={onToggle} aria-label={t("enabled")} />
        <div className="min-w-0 flex-1 basis-56">
          <button type="button" onClick={onEdit} className="block max-w-full truncate text-left font-mono text-sm hover:underline">
            {w.url}
          </button>
          <div className="text-xs text-muted-foreground">
            {w.events.join(", ")}
            {w.lastStatus !== null && ` · ${t("lastStatus", { status: w.lastStatus })}`}
            {w.failureCount > 0 && <span className="text-destructive"> · {t("failures", { count: w.failureCount })}</span>}
            {!w.isActive && w.failureCount >= 50 && <span className="text-destructive"> · {t("autoDisabled")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={onTest}>
            <Send />
            {t("test")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onRotate} aria-label={t("rotate")} title={t("rotate")}>
            <RefreshCw />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={toggleLog} aria-label={t("deliveries")} aria-expanded={open}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={t("delete")}>
            <Trash2 className="text-muted-foreground" />
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t px-3 py-2">
          {deliveries === null && <p className="text-xs text-muted-foreground">{t("loading")}</p>}
          {deliveries?.length === 0 && <p className="text-xs text-muted-foreground">{t("noDeliveries")}</p>}
          <ul className="divide-y text-xs">
            {deliveries?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className={cn("font-medium", d.ok ? "text-green-700 dark:text-green-400" : "text-destructive")}>{d.ok ? d.status : (d.status ?? t("noResponse"))}</span>
                <span className="font-mono">{d.event}</span>
                {d.attempt > 1 && <span className="text-muted-foreground">{t("attempt", { n: d.attempt })}</span>}
                {d.error && !d.ok && <span className="min-w-0 truncate text-muted-foreground">{d.error}</span>}
                <span className="ms-auto text-muted-foreground">
                  <LocalTime iso={d.createdAt} options={{ dateStyle: "short", timeStyle: "medium" }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const t = useTranslations("developers");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const res = await apiFetch<{ key: string }>("/api/developers", { body: { name: new FormData(e.currentTarget).get("name") } });
    if (!res.ok) return setError(res.error);
    onCreated(res.data!.key);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("newKey")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="name" label={t("keyName")} placeholder={t("keyNamePlaceholder")} required maxLength={60} autoFocus />
          <Button type="submit">{t("createKey")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WebhookDialog({ webhook, events, onClose, onSaved }: { webhook: WebhookRow | null; events: string[]; onClose: () => void; onSaved: (secret: string | null) => void }) {
  const t = useTranslations("developers");
  const [selected, setSelected] = useState<string[]>(webhook?.events ?? ["message.received"]);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { url: f.get("url"), description: f.get("description") || null, events: selected };
    const res = webhook
      ? await apiFetch(`/api/developers/webhooks/${webhook.id}`, { method: "PATCH", body })
      : await apiFetch<{ secret: string }>("/api/developers/webhooks", { body });
    if (!res.ok) return setError(res.error);
    onSaved(webhook ? null : (res.data as { secret: string }).secret);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{webhook ? t("editWebhook") : t("addWebhook")}</DialogTitle>
            <DialogDescription>{t("webhookDialogText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="url" label={t("url")} type="url" required defaultValue={webhook?.url} placeholder="https://example.com/webhooks/whatsapp" />
          <Field id="description" label={t("description")} defaultValue={webhook?.description ?? ""} maxLength={200} />
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">{t("events")}</legend>
            {events.map((ev) => (
              <label key={ev} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={selected.includes(ev)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, ev] : s.filter((x) => x !== ev)))} />
                <span>
                  <code className="text-xs">{ev}</code>
                  <span className="block text-xs text-muted-foreground">{t(`event.${ev.replace(".", "_")}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" disabled={!selected.length}>
            {t("save")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApiReference({ baseUrl, events }: { baseUrl: string; events: string[] }) {
  const t = useTranslations("developers");
  const api = `${baseUrl}/api/v1`;
  const examples: { title: string; code: string }[] = [
    { title: t("ref.listNumbers"), code: `curl ${api}/accounts \\\n  -H "Authorization: Bearer $WACRM_API_KEY"` },
    {
      title: t("ref.sendText"),
      code: `curl -X POST ${api}/messages \\\n  -H "Authorization: Bearer $WACRM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to": "+919000012345", "text": "Your order has shipped 🚚"}'`,
    },
    {
      title: t("ref.sendTemplate"),
      code: `curl -X POST ${api}/messages \\\n  -H "Authorization: Bearer $WACRM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to": "+919000012345", "template": {"name": "order_update", "language": "en_US", "body": ["Ravi", "#A-1001"]}}'`,
    },
    {
      title: t("ref.sendMedia"),
      code: `curl -X POST ${api}/messages \\\n  -H "Authorization: Bearer $WACRM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"to": "+919000012345", "media_url": "https://example.com/invoice.pdf", "text": "Your invoice"}'`,
    },
    { title: t("ref.messageStatus"), code: `curl ${api}/messages/MESSAGE_ID \\\n  -H "Authorization: Bearer $WACRM_API_KEY"` },
    {
      title: t("ref.upsertContact"),
      code: `curl -X POST ${api}/contacts \\\n  -H "Authorization: Bearer $WACRM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"phone": "+919000012345", "name": "Ravi", "fields": {"city": "Delhi"}, "tags": ["Website"], "opted_in": true}'`,
    },
    { title: t("ref.findContact"), code: `curl "${api}/contacts?phone=919000012345" \\\n  -H "Authorization: Bearer $WACRM_API_KEY"` },
    {
      title: t("ref.startFlow"),
      code: `curl -X POST ${api}/flows/FLOW_ID/start \\\n  -H "Authorization: Bearer $WACRM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"phone": "+919000012345", "variables": {"order_id": "A-1001"}}'`,
    },
    {
      title: t("ref.verify"),
      code: `// Node.js: verify X-WACRM-Signature on your webhook endpoint\nconst crypto = require("crypto");\nconst expected = "sha256=" + crypto\n  .createHmac("sha256", process.env.WACRM_WEBHOOK_SECRET)\n  .update(req.headers["x-wacrm-timestamp"] + "." + rawBody)\n  .digest("hex");\nconst valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-wacrm-signature"]));\n// Also reject requests whose timestamp is more than 5 minutes old`,
    },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reference")}</CardTitle>
        <CardDescription>{t("referenceText", { limit: 120 })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">{t("baseUrl")}</span>
          <code className="rounded bg-muted px-2 py-1 text-xs break-all">{api}</code>
        </div>
        {examples.map((ex) => (
          <details key={ex.title} className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{ex.title}</summary>
            <pre className="relative overflow-x-auto border-t bg-muted/50 p-3 text-xs">
              <code>{ex.code}</code>
            </pre>
          </details>
        ))}
        <p className="text-xs text-muted-foreground">{t("eventsList", { events: events.join(", ") })}</p>
      </CardContent>
    </Card>
  );
}
