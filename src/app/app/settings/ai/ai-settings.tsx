"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";

type Provider = "openai" | "gemini" | "anthropic";

const PROVIDER_NAMES: Record<Provider, string> = { openai: "OpenAI", gemini: "Google Gemini", anthropic: "Anthropic Claude" };

interface Settings {
  config: {
    provider: Provider | null;
    model: string | null;
    hasKey: boolean;
    instructions: string;
    autoReply: boolean;
    autoReplyWhen: "unassigned" | "always";
    handoffMessage: string;
  };
  usage: { feature: string; requests: number }[];
}

interface Article {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
}

export function AiSettings({ canManage, suggestedModels }: { canManage: boolean; suggestedModels: Record<Provider, string[]> }) {
  const t = useTranslations("aiSettings");
  const [data, setData] = useState<Settings | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [provider, setProvider] = useState<Provider>("openai");
  const [autoReply, setAutoReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<Article | "new" | null>(null);

  const load = useCallback(async () => {
    const [s, k] = await Promise.all([apiFetch<Settings>("/api/ai/settings"), apiFetch<{ articles: Article[] }>("/api/ai/knowledge")]);
    if (s.ok && s.data) {
      setData(s.data);
      setProvider(s.data.config.provider ?? "openai");
      setAutoReply(s.data.config.autoReply);
    }
    if (k.ok && k.data) setArticles(k.data.articles);
  }, []);
  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    const res = await apiFetch("/api/ai/settings", {
      method: "PUT",
      body: {
        provider,
        model: f.get("model"),
        apiKey: f.get("apiKey") || "",
        instructions: f.get("instructions") ?? "",
        autoReply,
        autoReplyWhen: f.get("autoReplyWhen") ?? "unassigned",
        handoffMessage: f.get("handoffMessage") ?? "",
      },
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    toast.success(t("saved"));
    void load();
  }

  async function test() {
    setTesting(true);
    const res = await apiFetch<{ reply: string }>("/api/ai/test", { body: {} });
    setTesting(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(t("testOk", { reply: res.data!.reply }));
    void load();
  }

  async function toggleArticle(a: Article, isActive: boolean) {
    const res = await apiFetch(`/api/ai/knowledge/${a.id}`, { method: "PATCH", body: { isActive } });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  async function removeArticle(a: Article) {
    if (!confirm(t("confirmDeleteArticle", { title: a.title }))) return;
    const res = await apiFetch(`/api/ai/knowledge/${a.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  if (!data) return <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>;
  const c = data.config;
  const totalRequests = data.usage.reduce((n, u) => n + u.requests, 0);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-fuchsia-600" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{t("status")}</div>
            {c.hasKey ? (
              <>
                <div className="mt-0.5 flex items-center gap-1.5 font-semibold text-green-700 dark:text-green-500">
                  <CheckCircle2 className="size-4" />
                  {t("connected")}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {PROVIDER_NAMES[c.provider ?? "openai"]} · {c.model}
                </div>
              </>
            ) : (
              <>
                <div className="mt-0.5 font-semibold text-amber-600">{t("notConnected")}</div>
                <div className="text-xs text-muted-foreground">{t("notConnectedText")}</div>
              </>
            )}
          </div>
          <div className="rounded-lg border p-3 sm:col-span-2">
            <div className="text-xs text-muted-foreground">{t("usage30")}</div>
            {totalRequests === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{t("noUsage")}</p>
            ) : (
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {data.usage.map((u) => (
                  <div key={u.feature} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t(`feature.${u.feature}`)}</dt>
                    <dd className="tabular-nums">{u.requests}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <form onSubmit={save}>
          <CardHeader>
            <CardTitle>{t("setup")}</CardTitle>
            <CardDescription>{t("setupText")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <FormMessage type="error">{error}</FormMessage>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="provider">{t("provider")}</Label>
                <NativeSelect id="provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)} disabled={!canManage}>
                  {(Object.keys(PROVIDER_NAMES) as Provider[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_NAMES[p]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="model">{t("model")}</Label>
                <Input
                  id="model"
                  name="model"
                  list="ai-models"
                  key={provider}
                  defaultValue={c.provider === provider && c.model ? c.model : suggestedModels[provider][0]}
                  required
                  maxLength={100}
                  disabled={!canManage}
                />
                <datalist id="ai-models">
                  {suggestedModels[provider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <Field id="apiKey" label={t("apiKey")} type="password" autoComplete="off" placeholder={c.hasKey ? t("keepKey") : ""} disabled={!canManage} />
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t("keyHelp")}</p>

            <div className="grid gap-1.5">
              <Label htmlFor="instructions">{t("instructions")}</Label>
              <Textarea id="instructions" name="instructions" rows={5} maxLength={4000} defaultValue={c.instructions} placeholder={t("instructionsPlaceholder")} disabled={!canManage} />
              <p className="text-xs text-muted-foreground">{t("instructionsHint")}</p>
            </div>

            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-start gap-3">
                <Switch checked={autoReply} onCheckedChange={setAutoReply} disabled={!canManage} aria-label={t("autoReply")} />
                <span className="text-sm">
                  <span className="font-medium">{t("autoReply")}</span>
                  <span className="block text-xs text-muted-foreground">{t("autoReplyText")}</span>
                </span>
              </label>
              {autoReply && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="autoReplyWhen">{t("autoReplyWhen")}</Label>
                    <NativeSelect id="autoReplyWhen" name="autoReplyWhen" defaultValue={c.autoReplyWhen} disabled={!canManage}>
                      <option value="unassigned">{t("when.unassigned")}</option>
                      <option value="always">{t("when.always")}</option>
                    </NativeSelect>
                  </div>
                  <Field id="handoffMessage" label={t("handoffMessage")} defaultValue={c.handoffMessage} maxLength={1000} placeholder={t("handoffPlaceholder")} disabled={!canManage} />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("privacy")}</p>
          </CardContent>
          {canManage && (
            <CardFooter className="mt-6 gap-2">
              <Button type="submit" disabled={saving}>
                {t("save")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void test()} disabled={testing}>
                {t("test")}
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" />
            {t("knowledge")}
          </CardTitle>
          <CardDescription>{t("knowledgeText")}</CardDescription>
          {canManage && (
            <CardAction>
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                {t("addArticle")}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="divide-y">
          {articles.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("noArticles")}</p>}
          {articles.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              {canManage && <Switch checked={a.isActive} onCheckedChange={(v) => void toggleArticle(a, v)} aria-label={t("useArticle", { title: a.title })} className="mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className={cn("font-medium", !a.isActive && "text-muted-foreground")}>{a.title}</div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{a.content}</p>
              </div>
              {canManage && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label={t("edit")}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeArticle(a)} aria-label={t("delete")}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && (
        <ArticleDialog
          article={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ArticleDialog({ article, onClose, onSaved }: { article: Article | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("aiSettings");
  const [content, setContent] = useState(article?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = { title: new FormData(e.currentTarget).get("title"), content };
    const res = article ? await apiFetch(`/api/ai/knowledge/${article.id}`, { method: "PATCH", body }) : await apiFetch("/api/ai/knowledge", { body });
    if (!res.ok) return setError(res.error);
    toast.success(t("articleSaved"));
    onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{article ? t("editArticle") : t("addArticle")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="title" label={t("articleTitle")} defaultValue={article?.title} required maxLength={150} placeholder={t("articleTitlePlaceholder")} />
          <div className="grid gap-1.5">
            <Label htmlFor="content">{t("articleContent")}</Label>
            <Textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} rows={12} maxLength={20000} required placeholder={t("articleContentPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("articleHint", { count: content.length })}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit">{t("save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
