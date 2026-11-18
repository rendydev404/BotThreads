"use client";

import React, { Activity, Suspense, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, Lightbulb, TrendingUp } from "lucide-react";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { useMe } from "@/components/layout/use-me";
import { useT } from "@/components/i18n/lang-provider";
import { PageIntro, PageTabs, type PageTab } from "@/components/layout/page-tabs";
import { IdeasTab } from "@/components/radar/ideas-tab";
import { MomentsTab } from "@/components/radar/moments-tab";
import { SignalsTab } from "@/components/radar/signals-tab";

type TabKey = "ide" | "tren" | "momen";

const TABS: PageTab<TabKey>[] = [
  { key: "ide", label: "Ide", icon: Lightbulb },
  { key: "tren", label: "Tren Viral", icon: TrendingUp },
  { key: "momen", label: "Momen", icon: CalendarDays },
];

function PageHeader() {
  return <PageIntro text="Apa yang lagi viral, bank ide, dan kalender momen yang menjadi bahan tulisan autopilot." />;
}

function PageSkeleton() {
  const t = useT();
  return (
    <div className="space-y-5" aria-busy="true" aria-label={t("Memuat radar")}>
      <PageHeader />
      <div className="h-12 w-72 max-w-full rounded-2xl bg-subtle animate-pulse" aria-hidden />
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


  // Server menolak tindakan karena peran (403): muat ulang profil supaya tombol ubah menyesuaikan.
  const onForbidden = useCallback(() => void reloadMe(), [reloadMe]);

  return (
    <div className="space-y-5">
      <PageHeader />
      <PageTabs tabs={TABS} value={tab} onChange={setTab} idPrefix="radar" ariaLabel="Bagian radar" />

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
