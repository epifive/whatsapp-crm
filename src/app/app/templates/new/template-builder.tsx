"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MessagePreview } from "@/components/whatsapp/message-preview";

type HeaderFormat = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonDraft = { type: "QUICK_REPLY"; text: string } | { type: "URL"; text: string; url: string; example: string } | { type: "PHONE_NUMBER"; text: string; phone: string };

const ACCEPT: Record<string, string> = { IMAGE: "image/jpeg,image/png", VIDEO: "video/mp4", DOCUMENT: "application/pdf" };

function numberedVars(text: string): number {
  const nums = [...text.matchAll(/{{\s*(\d+)\s*}}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

export function TemplateBuilder({
  accounts,
  initialAccountId,
  languages,
}: {
  accounts: { id: string; name: string; phone: string | null }[];
  initialAccountId: string;
  languages: string[];
}) {
  const t = useTranslations("templates");
  const router = useRouter();
  const [accountId, setAccountId] = useState(initialAccountId);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [language, setLanguage] = useState("en");
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const varCount = numberedVars(body);
  const headerHasVar = /{{\s*1\s*}}/.test(headerText);
  // Object URL for the image preview, released when the file changes
  const fileUrl = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (fileUrl && URL.revokeObjectURL(fileUrl)), [fileUrl]);

  function insertVariable() {
    const el = bodyRef.current;
    const token = `{{${varCount + 1}}}`;
    const at = el?.selectionStart ?? body.length;
    setBody(body.slice(0, at) + token + body.slice(at));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  const fillVars = (text: string, values: string[]) => text.replace(/{{\s*(\d+)\s*}}/g, (m, n: string) => values[Number(n) - 1] || m);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const data = {
      accountId,
      name,
      language,
      category,
      header:
        headerFormat === "NONE"
          ? null
          : headerFormat === "TEXT"
            ? { format: "TEXT", text: headerText, examples: headerHasVar ? [headerExample] : [] }
            : { format: headerFormat, examples: [] },
      body: { text: body, examples: examples.slice(0, varCount) },
      footer: footer.trim() || null,
      buttons: buttons.map((b) => (b.type === "URL" ? { ...b, example: /{{\s*1\s*}}/.test(b.url) ? b.example : undefined } : b)),
    };
    const form = new FormData();
    form.append("data", JSON.stringify(data));
    if (file && headerFormat !== "NONE" && headerFormat !== "TEXT") form.append("file", file);
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", { method: "POST", body: form, credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) return setError(json?.error ?? t("submitFailed"));
      toast.success(t("submitted"));
      router.push(`/app/templates?account=${accountId}`);
    } catch {
      setError(t("submitFailed"));
    } finally {
      setPending(false);
    }
  }

  const quickReplies = buttons.filter((b) => b.type === "QUICK_REPLY").length;
  return (
    <form onSubmit={submit} className="grid gap-6">
      <div className="flex items-center gap-3">
        <Link href={`/app/templates?account=${accountId}`} className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("new")}</h1>
          <p className="text-sm text-muted-foreground">{t("builderSubtitle")}</p>
        </div>
      </div>
      <FormMessage type="error">{error}</FormMessage>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("basics")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="tpl-name">{t("name")}</Label>
                <Input
                  id="tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))}
                  required
                  maxLength={512}
                  placeholder="diwali_offer_2026"
                />
                <p className="text-xs text-muted-foreground">{t("nameHint")}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-category">{t("categoryLabel")}</Label>
                <NativeSelect id="tpl-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {(["MARKETING", "UTILITY", "AUTHENTICATION"] as const).map((c) => (
                    <option key={c} value={c}>
                      {t(`category.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-language">{t("language")}</Label>
                <NativeSelect id="tpl-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {accounts.length > 1 && (
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="tpl-account">{t("number")}</Label>
                  <NativeSelect id="tpl-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.phone ? ` (+${a.phone})` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <p className="text-xs text-muted-foreground sm:col-span-2">{t(`categoryHint.${category}`)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("content")}</CardTitle>
              <CardDescription>{t("contentHelp")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-header">{t("header")}</Label>
                <NativeSelect
                  id="tpl-header"
                  value={headerFormat}
                  onChange={(e) => {
                    setHeaderFormat(e.target.value as HeaderFormat);
                    setFile(null);
                  }}
                  className="max-w-xs"
                >
                  {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`headerFormat.${f}`)}
                    </option>
                  ))}
                </NativeSelect>
                {headerFormat === "TEXT" && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} maxLength={60} placeholder={t("headerTextPlaceholder")} aria-label={t("headerText")} />
                    {headerHasVar && <Input value={headerExample} onChange={(e) => setHeaderExample(e.target.value)} placeholder={t("exampleFor", { n: 1 })} aria-label={t("exampleFor", { n: 1 })} />}
                  </div>
                )}
                {headerFormat !== "NONE" && headerFormat !== "TEXT" && (
                  <div className="grid gap-1">
                    <Input type="file" accept={ACCEPT[headerFormat]} onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label={t("sampleFile")} />
                    <p className="text-xs text-muted-foreground">{t("sampleHint")}</p>
                  </div>
                )}
              </div>

              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="tpl-body">{t("body")}</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={insertVariable} disabled={varCount >= 20}>
                    <Plus />
                    {t("addVariable")}
                  </Button>
                </div>
                <Textarea id="tpl-body" ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={1024} required placeholder={t("bodyPlaceholder")} />
                <p className="text-xs text-muted-foreground">{t("bodyHint", { count: body.length })}</p>
                {varCount > 0 && (
                  <div className="grid gap-2 rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t("examplesHelp")}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {Array.from({ length: varCount }, (_, i) => (
                        <Input
                          key={i}
                          value={examples[i] ?? ""}
                          onChange={(e) => setExamples((ex) => Object.assign([...ex], { [i]: e.target.value }))}
                          placeholder={t("exampleFor", { n: i + 1 })}
                          aria-label={t("exampleFor", { n: i + 1 })}
                          required
                          maxLength={200}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tpl-footer">{t("footer")}</Label>
                <Input id="tpl-footer" value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={60} placeholder={t("footerPlaceholder")} />
              </div>

              <div className="grid gap-2">
                <Label>{t("buttons")}</Label>
                {buttons.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                    <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">{t(`buttonType.${b.type}`)}</span>
                    <Input
                      value={b.text}
                      onChange={(e) => setButtons((list) => list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                      placeholder={t("buttonText")}
                      aria-label={t("buttonText")}
                      maxLength={25}
                      required
                      className="h-8 min-w-28 flex-1"
                    />
                    {b.type === "URL" && (
                      <>
                        <Input
                          value={b.url}
                          onChange={(e) => setButtons((list) => list.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                          placeholder="https://example.com/{{1}}"
                          aria-label={t("buttonUrl")}
                          required
                          className="h-8 min-w-48 flex-[2]"
                        />
                        {/{{\s*1\s*}}/.test(b.url) && (
                          <Input
                            value={b.example}
                            onChange={(e) => setButtons((list) => list.map((x, j) => (j === i ? { ...x, example: e.target.value } : x)))}
                            placeholder={t("buttonUrlExample")}
                            aria-label={t("buttonUrlExample")}
                            required
                            className="h-8 min-w-48 flex-[2]"
                          />
                        )}
                      </>
                    )}
                    {b.type === "PHONE_NUMBER" && (
                      <Input
                        value={b.phone}
                        onChange={(e) => setButtons((list) => list.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                        placeholder="+919000012345"
                        aria-label={t("buttonPhone")}
                        required
                        inputMode="tel"
                        className="h-8 min-w-36 flex-1"
                      />
                    )}
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeButton")} onClick={() => setButtons((list) => list.filter((_, j) => j !== i))}>
                      <X />
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={buttons.length >= 10} onClick={() => setButtons((l) => [...l, { type: "QUICK_REPLY", text: "" }])}>
                    <Plus />
                    {t("buttonType.QUICK_REPLY")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={buttons.filter((b) => b.type === "URL").length >= 2 || buttons.length >= 10}
                    onClick={() => setButtons((l) => [...l, { type: "URL", text: "", url: "https://", example: "" }])}
                  >
                    <Plus />
                    {t("buttonType.URL")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={buttons.some((b) => b.type === "PHONE_NUMBER") || buttons.length >= 10}
                    onClick={() => setButtons((l) => [...l, { type: "PHONE_NUMBER", text: "", phone: "" }])}
                  >
                    <Plus />
                    {t("buttonType.PHONE_NUMBER")}
                  </Button>
                </div>
                {quickReplies > 0 && buttons.length > quickReplies && <p className="text-xs text-muted-foreground">{t("buttonsOrderHint")}</p>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:sticky lg:top-20">
          <div className="text-sm font-medium">{t("preview")}</div>
          <MessagePreview
            headerFormat={headerFormat === "NONE" ? null : headerFormat}
            headerText={headerFormat === "TEXT" ? fillVars(headerText, [headerExample]) : null}
            mediaUrl={fileUrl}
            mediaName={file?.name}
            body={fillVars(body, examples)}
            footer={footer}
            buttons={buttons}
          />
          <p className="text-xs text-muted-foreground">{t("reviewNote")}</p>
          <Button type="submit" disabled={pending}>
            {t("submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
