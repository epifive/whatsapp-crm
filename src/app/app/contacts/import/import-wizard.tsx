"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { LocalTime } from "@/components/crm/local-time";
import type { FieldDefItem } from "@/components/crm/types";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api-client";
import { useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

interface ImportItem {
  id: string;
  fileName: string;
  status: "DRAFT" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; error: string }[];
  createdAt: string;
  finishedAt: string | null;
}

interface Upload {
  import: ImportItem;
  header: string[];
  preview: string[][];
  mapping: string[];
}

const SAMPLE = "name,phone,email,tags\r\nRavi Sharma,+91 90000 12345,ravi@example.com,\"VIP, Delhi\"\r\nAsha Patel,+44 7700 900123,,Wholesale\r\n";

export function ImportWizard({ fields, recent: initialRecent }: { fields: FieldDefItem[]; recent: ImportItem[] }) {
  const t = useTranslations("imports");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [running, setRunning] = useState<ImportItem | null>(null);
  const [recent, setRecent] = useState(initialRecent);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function sendFile(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/contacts/imports", { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) return setError(json?.error ?? t("uploadFailed"));
      setUpload(json);
      setMapping(json.mapping);
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!upload) return;
    const f = new FormData(e.currentTarget);
    const options = {
      defaultCountryCode: String(f.get("countryCode") ?? "").replace(/\D/g, ""),
      updateExisting: f.get("updateExisting") === "on",
      markOptedIn: f.get("markOptedIn") === "on",
      tags: String(f.get("tags") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    setBusy(true);
    const res = await apiFetch<{ import: ImportItem }>(`/api/contacts/imports/${upload.import.id}/start`, { body: { mapping, options } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setRunning(res.data!.import);
    setUpload(null);
  }

  async function cancel() {
    if (upload) await apiFetch(`/api/contacts/imports/${upload.import.id}`, { method: "DELETE", body: {} });
    setUpload(null);
    setError(null);
  }

  const poll = useCallback(async () => {
    if (!running) return;
    const res = await apiFetch<{ import: ImportItem }>(`/api/contacts/imports/${running.id}`);
    if (!res.ok || !res.data) return;
    setRunning(res.data.import);
    if (res.data.import.status === "COMPLETED" || res.data.import.status === "FAILED") {
      setRecent((prev) => [res.data!.import, ...prev.filter((i) => i.id !== res.data!.import.id)]);
    }
  }, [running]);

  // Progress arrives over realtime; a slow poll covers a dropped socket
  useRealtime<{ importId: string }>("import.updated", (ev) => ev.importId === running?.id && void poll());
  const active = running && (running.status === "PENDING" || running.status === "PROCESSING");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void poll(), 3000);
    return () => clearInterval(timer);
  }, [active, poll]);

  const targets = [
    { value: "ignore", label: t("target.ignore") },
    { value: "phone", label: t("target.phone") },
    { value: "name", label: t("target.name") },
    { value: "email", label: t("target.email") },
    { value: "tags", label: t("target.tags") },
    ...fields.map((f) => ({ value: `field:${f.key}`, label: f.label })),
  ];
  const hasPhone = mapping.includes("phone");

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex items-center gap-3">
        <Link href="/app/contacts" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <FormMessage type="error">{error}</FormMessage>

      {!upload && !running && (
        <Card>
          <CardContent>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void sendFile(file);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
              )}
            >
              {busy ? <Loader2 className="size-8 animate-spin text-muted-foreground" /> : <FileUp className="size-8 text-muted-foreground" />}
              <span className="font-medium">{t("dropFile")}</span>
              <span className="text-sm text-muted-foreground">{t("fileHint")}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void sendFile(file);
                }}
              />
            </label>
            <p className="mt-4 text-sm text-muted-foreground">
              {t("sampleText")}{" "}
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="contacts-sample.csv" className="font-medium text-primary hover:underline">
                {t("downloadSample")}
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      {upload && (
        <form onSubmit={start} className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("mapTitle")}</CardTitle>
              <CardDescription>{t("mapText", { file: upload.import.fileName, rows: upload.import.totalRows })}</CardDescription>
            </CardHeader>
            <CardContent className="relative overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pe-3 font-medium">{t("column")}</th>
                    <th className="py-2 pe-3 font-medium">{t("sample")}</th>
                    <th className="py-2 font-medium">{t("importAs")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {upload.header.map((col, i) => (
                    <tr key={i}>
                      <td className="py-2 pe-3 font-medium">{col}</td>
                      <td className="max-w-56 truncate py-2 pe-3 text-muted-foreground">
                        {upload.preview
                          .map((r) => r[i])
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(" · ")}
                      </td>
                      <td className="py-2">
                        <NativeSelect
                          aria-label={t("importAsFor", { column: col })}
                          value={mapping[i] ?? "ignore"}
                          onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value : v)))}
                          className="w-full"
                        >
                          {targets.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!hasPhone && <p className="mt-3 text-sm text-destructive">{t("needPhone")}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("optionsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field id="countryCode" label={t("countryCode")} hint={t("countryCodeHint")} placeholder="91" maxLength={4} inputMode="numeric" className="max-w-xs" />
              <Field id="tags" label={t("extraTags")} hint={t("extraTagsHint")} maxLength={300} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="updateExisting" defaultChecked className="mt-0.5 size-4 accent-primary" />
                <span>
                  {t("updateExisting")}
                  <span className="block text-xs text-muted-foreground">{t("updateExistingHint")}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="markOptedIn" className="mt-0.5 size-4 accent-primary" />
                <span>
                  {t("markOptedIn")}
                  <span className="block text-xs text-muted-foreground">{t("markOptedInHint")}</span>
                </span>
              </label>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !hasPhone}>
              {t("start", { rows: upload.import.totalRows })}
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}

      {running && <Progress item={running} onAnother={() => setRunning(null)} />}

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("recent")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {recent.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{i.fileName}</span>
                  <span className="text-muted-foreground">{t("summary", { created: i.created, updated: i.updated, failed: i.failed })}</span>
                  <span className={cn("text-xs font-medium", i.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>{t(`status.${i.status}`)}</span>
                  <LocalTime iso={i.createdAt} className="text-xs text-muted-foreground" options={{ dateStyle: "medium", timeStyle: "short" }} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Progress({ item, onAnother }: { item: ImportItem; onAnother: () => void }) {
  const t = useTranslations("imports");
  const done = item.status === "COMPLETED" || item.status === "FAILED";
  const pct = item.totalRows ? Math.round((item.processedRows / item.totalRows) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {!done && <Loader2 className="size-4 animate-spin" />}
          {item.status === "COMPLETED" && <CheckCircle2 className="size-5 text-primary" />}
          {item.status === "FAILED" && <AlertTriangle className="size-5 text-destructive" />}
          {t(`status.${item.status}`)}
        </CardTitle>
        <CardDescription>{item.fileName}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${done ? 100 : pct}%` }} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(["created", "updated", "skipped", "failed"] as const).map((k) => (
            <div key={k} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{t(`counts.${k}`)}</dt>
              <dd className="text-xl font-semibold tabular-nums">{item[k].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
        {item.errors.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-sm font-medium">{t("errorsTitle")}</h3>
            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
              {item.errors.map((e, i) => (
                <li key={i} className="flex gap-3 px-3 py-1.5">
                  {e.row > 0 && <span className="shrink-0 text-muted-foreground tabular-nums">{t("row", { row: e.row })}</span>}
                  <span className="min-w-0 break-words">{e.error}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {done && (
          <div className="flex gap-2">
            <Link href="/app/contacts" className={buttonVariants()}>
              {t("viewContacts")}
            </Link>
            <Button variant="outline" onClick={onAnother}>
              {t("another")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
