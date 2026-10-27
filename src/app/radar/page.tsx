"use client";

import React, { Activity, Suspense, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { useMe } from "@/components/layout/use-me";
import { useT } from "@/components/i18n/lang-provider";
import { IdeasTab } from "@/components/radar/ideas-tab";
import { MomentsTab } from "@/components/radar/moments-tab";
import { SignalsTab } from "@/components/radar/signals-tab";

type TabKey = "ide" | "tren" | "momen";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ide", label: "Ide" },
  { key: "tren", label: "Tren Viral" },
  { key: "momen", label: "Momen" },
];

function PageHeader() {
  const t = useT();
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
        <Radar className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-fg leading-tight">Radar</h2>
        <p className="text-sm text-muted">{t("Apa yang lagi viral, bank ide, dan kalender momen yang menjadi bahan tulisan autopilot.")}</p>
      </div>
    </div>
  );
}

function PageSkeleton() {
  const t = useT();
  return (
    <div className="space-y-5" aria-busy="true" aria-label={t("Memuat radar")}>
      <PageHeader />
      <div className="flex gap-6 border-b border-line" aria-hidden>
        {TABS.map((tab) => (
          <span key={tab.key} className="h-11 inline-flex items-center text-sm font-semibold text-muted">
            {t(tab.label)}
          </span>
        ))}
      </div>
      <ListSkeleton label={t("Memuat daftar")} />
    </div>
  );
}

function RadarInner() {
  const { me, error: meError, canEdit, reload: reloadMe } = useMe();
  const tr = useT();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  // "sinyal" = nama lama tab Tren Viral; tautan lama tetap membuka tab yang sama.
  const tab: TabKey = rawTab === "tren" || rawTab === "sinyal" ? "tren" : rawTab === "momen" ? "momen" : "ide";

  // Tab aktif disimpan di URL (?tab=) lewat History API: tanpa navigasi ulang ke server.
  const setTab = (next: TabKey) => {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ide") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const at = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    document.getElementById(`radar-tab-${next.key}`)?.focus();
  };

  // Server menolak tindakan karena peran (403): muat ulang profil supaya tombol ubah menyesuaikan.
  const onForbidden = useCallback(() => void reloadMe(), [reloadMe]);

  return (
    <div className="space-y-5">
      <PageHeader />

      {/* Semua tindakan ubah di halaman ini butuh peran Editor ke atas (sama dengan route API-nya). */}
      {me && !canEdit && (
        <Banner tone="info">
          {tr(
            "Peran Anda {role}, jadi halaman ini hanya bisa dilihat. Menyematkan atau menolak ide, menambah inspirasi, dan mengatur momen butuh peran Editor ke atas.",
            { role: tr(me.roleLabel) }
          )}
        </Banner>
      )}
      {!me && meError && (
        <Banner tone="warning">
          {tr("Peran Anda belum bisa dipastikan ({error}), jadi tombol ubah disembunyikan.", { error: tr(meError) })}{" "}
          <button type="button" onClick={onForbidden} className="underline font-semibold cursor-pointer">
            {tr("Coba lagi")}
          </button>
        </Banner>
      )}

      {/* Tab */}
      <div role="tablist" aria-label={tr("Bagian radar")} onKeyDown={onTabKey} className="flex gap-6 border-b border-line">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`radar-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`radar-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                "relative h-11 inline-flex items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                active ? "text-accent" : "text-muted hover:text-fg"
              )}
            >
              {tr(t.label)}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {/*
        Panel tetap terpasang (saringan dan isian tidak hilang saat pindah tab); efek, termasuk fetch,
        hanya jalan saat terlihat, jadi tiap tab baru memuat datanya ketika pertama kali dibuka.
      */}
      <div>
        <Activity mode={tab === "ide" ? "visible" : "hidden"}>
          <div role="tabpanel" id="radar-panel-ide" aria-labelledby="radar-tab-ide">
            <IdeasTab canEdit={canEdit} onForbidden={onForbidden} />
          </div>
        </Activity>
        <Activity mode={tab === "tren" ? "visible" : "hidden"}>
          <div role="tabpanel" id="radar-panel-tren" aria-labelledby="radar-tab-tren">
            <SignalsTab canEdit={canEdit} onForbidden={onForbidden} />
          </div>
        </Activity>
        <Activity mode={tab === "momen" ? "visible" : "hidden"}>
          <div role="tabpanel" id="radar-panel-momen" aria-labelledby="radar-tab-momen">
            <MomentsTab canEdit={canEdit} onForbidden={onForbidden} />
          </div>
        </Activity>
      </div>
    </div>
  );
}

export default function RadarPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RadarInner />
    </Suspense>
  );
}
