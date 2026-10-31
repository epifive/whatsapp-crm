"use client";

import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Languages, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/client/api-client";

export const LANGUAGES = ["English", "Hindi", "Hinglish", "Bengali", "Marathi", "Gujarati", "Tamil", "Telugu", "Urdu", "Arabic", "Spanish", "Portuguese", "French", "Indonesian", "German", "Turkish", "Russian"];

const LANG_KEY = "wacrm_translate_lang";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/** The language this browser translates customer messages into (remembered locally) */
export function useTranslateLanguage(): [string, (l: string) => void] {
  const lang = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(LANG_KEY) ?? "English",
    () => "English",
  );
  return [
    lang,
    (l: string) => {
      localStorage.setItem(LANG_KEY, l);
      window.dispatchEvent(new StorageEvent("storage", { key: LANG_KEY }));
    },
  ];
}

async function assist(body: Record<string, unknown>): Promise<string | null> {
  const res = await apiFetch<{ text: string }>("/api/ai/assist", { body });
  if (!res.ok) {
    toast.error(res.error);
    return null;
  }
  return res.data!.text;
}

/** ✨ menu in the composer: draft a reply, or rewrite / translate what the agent typed */
export function AiMenu({ conversationId, text, onText }: { conversationId: string; text: string; onText: (t: string) => void }) {
  const t = useTranslations("inbox.ai");
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    const out = await assist(body);
    setBusy(false);
    if (out) onText(out);
  };
  const hasText = !!text.trim();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t("menu")} title={t("menu")} disabled={busy} />}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5 text-fuchsia-600" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("menu")}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void run({ action: "suggest", conversationId })}>{t("suggest")}</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{hasText ? t("yourDraft") : t("typeFirst")}</DropdownMenuLabel>
          {(["improve", "shorter", "friendlier", "formal"] as const).map((mode) => (
            <DropdownMenuItem key={mode} disabled={!hasText} onClick={() => void run({ action: "rewrite", text, mode })}>
              {t(`mode.${mode}`)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasText}>{t("translateTo")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {LANGUAGES.map((l) => (
                <DropdownMenuItem key={l} onClick={() => void run({ action: "translate_draft", text, language: l })}>
                  {l}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Translate" on a customer message; the result shows under the original */
export function TranslateMessage({ messageId }: { messageId: string }) {
  const t = useTranslations("inbox.ai");
  const [lang, setLang] = useTranslateLanguage();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const translate = async (language: string) => {
    setBusy(true);
    const out = await assist({ action: "translate_message", messageId, language });
    setBusy(false);
    if (out) setResult(out);
  };

  if (result) {
    return (
      <div className="mt-1.5 border-t pt-1.5 text-sm">
        <div className="mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Languages className="size-3" />
          {t("translatedTo", { language: lang })}
        </div>
        <p className="whitespace-pre-wrap break-words">{result}</p>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-0.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <button
        type="button"
        onClick={() => void translate(lang)}
        disabled={busy}
        title={t("translate", { language: lang })}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Languages className="size-3" />}
        {t("translateShort")}
      </button>
      <span aria-hidden>·</span>
      <select
        aria-label={t("translateLanguage")}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="h-5 max-w-24 cursor-pointer appearance-none rounded border-none bg-transparent px-0.5 text-[11px] hover:text-foreground"
      >
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Summary of the chat for the team, with an option to keep it as a note */
export function SummaryButton({ conversationId, onNoteSaved }: { conversationId: string; onNoteSaved: () => void }) {
  const t = useTranslations("inbox.ai");
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function summarize() {
    setBusy(true);
    const out = await assist({ action: "summary", conversationId });
    setBusy(false);
    if (out) setSummary(out);
  }

  async function saveNote() {
    const res = await apiFetch(`/api/inbox/conversations/${conversationId}/notes`, { body: { body: `${t("summaryNotePrefix")}\n${summary}` } });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("noteSaved"));
    setSummary(null);
    onNoteSaved();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => void summarize()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles className="text-fuchsia-600" />}
        {t("summarize")}
      </Button>
      <Dialog open={summary !== null} onOpenChange={(o) => !o && setSummary(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("summaryTitle")}</DialogTitle>
            <DialogDescription>{t("summaryText")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap">{summary}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSummary(null)}>
              {t("close")}
            </Button>
            <Button onClick={() => void saveNote()}>{t("saveAsNote")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
