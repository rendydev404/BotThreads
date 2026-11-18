"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";

export interface PageTab<K extends string> {
  key: K;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Angka kecil di samping label (mis. draf menunggu). 0/undefined = tidak tampil. */
  badge?: number;
  badgeLabel?: string;
}

/**
 * Kalimat pembuka halaman. Judul sudah tampil di bilah atas, jadi di sini cukup satu kalimat apa gunanya
 * halaman ini (tanpa ikon dan judul ganda) plus tombol aksi halaman di kanan.
 */
export function PageIntro({ text, children }: { text: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    // HP: judul sudah di bilah atas dan layar sempit, jadi kalimat ini cukup untuk pembaca layar; tanpa tombol
    // aksi, barisnya tidak memakan tempat sama sekali.
    <div className={cn("flex flex-row items-center justify-between gap-3", !children && "max-sm:contents")}>
      <p className="text-sm text-muted leading-relaxed max-w-2xl max-sm:sr-only">{t(text)}</p>
      {children}
    </div>
  );
}

/**
 * Navigasi bagian halaman: tombol berikon dalam satu kapsul, menempel di bawah bilah atas saat digulir supaya
 * pindah bagian selalu satu ketukan. Layar sempit: kapsul digeser di dalamnya sendiri, halaman tidak melebar.
 */
export function PageTabs<K extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
  ariaLabel,
  tourId,
}: {
  tabs: PageTab<K>[];
  value: K;
  onChange: (next: K) => void;
  idPrefix: string;
  ariaLabel: string;
  tourId?: string;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  // Tab aktif selalu terlihat di kapsul yang bisa digeser (mis. dibuka lewat tautan ?tab=riwayat di HP).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [value]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const at = tabs.findIndex((x) => x.key === value);
    const next = tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.key);
    document.getElementById(`${idPrefix}-tab-${next.key}`)?.focus();
  };

  return (
    <div className="sticky top-16 z-10 -mx-4 px-4 md:-mx-8 md:px-8 py-2 bg-bg/90 backdrop-blur">
      <div
        ref={listRef}
        role="tablist"
        aria-label={t(ariaLabel)}
        data-tour={tourId}
        onKeyDown={onKey}
        className="flex gap-1 p-1 rounded-2xl bg-subtle w-max max-w-full overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(to_right,#000_85%,transparent)]"
      >
        {tabs.map((tb) => {
          const active = tb.key === value;
          const Icon = tb.icon;
          return (
            <button
              key={tb.key}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tb.key}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel-${tb.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => !active && onChange(tb.key)}
              className={cn(
                "shrink-0 h-11 sm:h-10 px-3.5 rounded-xl inline-flex items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", active ? "text-accent" : "")} />
              {t(tb.label)}
              {!!tb.badge && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-warning-soft text-warning text-[11px] font-bold inline-flex items-center justify-center tabular-nums">
                  {tb.badge}
                  {tb.badgeLabel && <span className="sr-only"> {t(tb.badgeLabel)}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
