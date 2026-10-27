"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { Lang } from "@/lib/i18n/core";
import { useLang } from "./lang-provider";

const OPTIONS: { value: Lang; label: string; title: string }[] = [
  { value: "id", label: "ID", title: "Bahasa Indonesia" },
  { value: "en", label: "EN", title: "English" },
];

/** Saklar bahasa "ID | EN" (header dan halaman masuk). */
export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  const [busy, setBusy] = useState(false);

  const pick = async (next: Lang) => {
    if (busy || next === lang) return;
    setBusy(true);
    try {
      await setLang(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="group"
      aria-label={t("Bahasa")}
      className={cn("flex items-center h-9 p-0.5 rounded-lg border border-line bg-surface text-xs font-bold", className)}
    >
      {OPTIONS.map((o) => {
        const active = lang === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            lang={o.value}
            aria-pressed={active}
            disabled={busy}
            onClick={() => void pick(o.value)}
            className={cn(
              "h-full min-w-8 px-2 rounded-md transition-colors cursor-pointer disabled:cursor-wait",
              active ? "bg-accent-soft text-accent" : "text-muted hover:text-fg hover:bg-subtle"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
