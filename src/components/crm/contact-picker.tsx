"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";

export interface PickedContact {
  id: string;
  name: string;
  phone: string;
}

/** Search-as-you-type contact chooser (name, phone or email) */
export function ContactPicker({ value, onChange, disabled }: { value: PickedContact | null; onChange: (c: PickedContact | null) => void; disabled?: boolean }) {
  const t = useTranslations("crm");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedContact[]>([]);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      const res = await apiFetch<{ contacts: PickedContact[] }>(`/api/contacts?q=${encodeURIComponent(q)}`);
      setResults(res.data?.contacts.slice(0, 8) ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {value.name} {value.phone && <span className="text-muted-foreground">+{value.phone}</span>}
        </span>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t("clear")} onClick={() => onChange(null)}>
            <X />
          </Button>
        )}
      </div>
    );
  }

  const open = query.trim().length >= 2;
  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("searchContact")}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("noMatches")}</li>}
          {results.map((c) => (
            <li key={c.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange({ id: c.id, name: c.name, phone: c.phone });
                  setQuery("");
                  setResults([]);
                }}
              >
                {c.name} <span className="text-muted-foreground">+{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
