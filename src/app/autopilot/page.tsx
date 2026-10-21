"use client";

import React, { Activity, Suspense, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, Bot, Database, Pause, Play, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { setAutopilotActive } from "@/lib/autopilot-client";
import type { AutopilotOverviewResponse, SlotStatus } from "@/lib/autopilot-types";
import { ContentApiError } from "@/lib/content-client";
import { AccountsTab } from "@/components/autopilot/accounts-tab";
import { AffiliateTab } from "@/components/autopilot/affiliate-tab";
import { AiPipeline } from "@/components/autopilot/ai-pipeline";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { HistoryTab } from "@/components/autopilot/history-tab";
import { PlanTab } from "@/components/autopilot/plan-tab";
import { RepliesTab } from "@/components/autopilot/replies-tab";
import { ReviewTab } from "@/components/autopilot/review-tab";
import { Banner, accountHandle, durationText, timeOf } from "@/components/autopilot/shared";
import { useAutopilotOverview } from "@/components/autopilot/use-autopilot-overview";

type TabKey = "akun" | "rencana" | "tinjau" | "komentar" | "riwayat" | "affiliate";

const TABS: { key: TabKey; label: string }[] = [
  { key: "akun", label: "Akun" },
  { key: "rencana", label: "Rencana" },
  { key: "tinjau", label: "Tinjau" },
  { key: "komentar", label: "Komentar" },
  { key: "riwayat", label: "Riwayat" },
  { key: "affiliate", label: "Affiliate" },
];

function PageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      {/* Di layar kecil judul sudah tampil di bilah atas; di sini cukup untuk pembaca layar. */}
      <div className="flex items-center gap-3 min-w-0 max-sm:sr-only">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-fg leading-tight">Autopilot</h2>
          <p className="text-sm text-muted">AI menulis dan menjadwalkan posting setiap hari di jam ramai tiap akun.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string | number; tone?: "accent" | "success" | "danger" }) {
  return (
    <div className="card p-2.5 sm:p-4 min-w-0 flex flex-col">
      <p className="text-[11px] sm:text-xs font-semibold text-muted leading-tight line-clamp-2">{label}</p>
      <p
        className={cn(
          "mt-auto pt-1 text-lg sm:text-2xl font-bold tabular-nums leading-tight",
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "accent" ? "text-accent" : "text-fg"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Memuat autopilot">
      <PageHeader />
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-3 w-20 rounded bg-subtle" />
            <div className="mt-2.5 h-7 w-14 rounded bg-subtle" />
          </div>
        ))}
      </div>
      <div className="card divide-y divide-line animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-subtle shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-subtle" />
              <div className="h-3 w-2/3 rounded bg-subtle" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutopilotInner() {
  const { data, error, loadedAt, refetch, patch } = useAutopilotOverview();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const tab: TabKey =
    rawTab === "rencana" || rawTab === "tinjau" || rawTab === "komentar" || rawTab === "riwayat" || rawTab === "affiliate" ? rawTab : "akun";

  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);

  // Halaman yang disembunyikan (pindah rute dengan Cache Components) tidak boleh kembali dengan dialog terbuka.
  useLayoutEffect(() => () => setPauseOpen(false), []);

  // Tab aktif disimpan di URL (?tab=) lewat History API: tanpa navigasi ulang ke server.
  const setTab = (next: TabKey) => {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "akun") params.delete("tab");
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
    document.getElementById(`autopilot-tab-${next.key}`)?.focus();
  };

  const handles = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, accountHandle(a)])), [data?.accounts]);
  const summary = useMemo(() => {
    if (!data) return null;
    const today = data.slots.filter((s) => s.dayKey === data.today);
    return {
      active: data.accounts.filter((a) => a.config.mode !== "MATI").length,
      total: data.accounts.length,
      slotsToday: today.length,
      publishedToday: today.filter((s) => s.status === "TERBIT").length,
      attention:
        today.filter((s) => s.status === "GAGAL" || s.status === "DILEWATI").length +
        data.accounts.filter((a) => a.config.pausedReason).length,
    };
  }, [data]);

  /** Tindakan tinjau berhasil: ubah status slot dan lencana tab secara lokal, tanpa fetch ulang. */
  const onResolved = useCallback(
    (slotId: string, status: SlotStatus) => {
      patch((d: AutopilotOverviewResponse) => {
        const slots = d.slots.map((s) => (s.id === slotId ? { ...s, status } : s));
        return { ...d, slots, reviewCount: slots.filter((s) => s.status === "MENUNGGU_TINJAU").length };
      });
    },
    [patch]
  );
  const onStale = useCallback(() => void refetch(), [refetch]);

  if (!data) {
    if (!error) return <PageSkeleton />;
    return (
      <div className="space-y-5">
        <PageHeader />
        <div role="alert" className="card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{error}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-4 h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-accent-hover"
          >
            <RotateCw className="w-4 h-4" />
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!data.installed) {
    return (
      <div className="space-y-5">
        <PageHeader />
        <div className="card p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-warning-soft text-warning flex items-center justify-center">
            <Database className="w-6 h-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-fg">Autopilot belum dipasang.</h3>
          <p className="mt-1 text-sm text-muted max-w-md mx-auto">
            Pemilik dashboard perlu menjalankan{" "}
            <code className="px-1.5 py-0.5 rounded-md bg-subtle text-fg text-[13px] font-semibold break-all">sql/005_autopilot.sql</code>{" "}
            di Supabase.
          </p>
        </div>
      </div>
    );
  }

  const paused = !data.workspaceActive;
  const { health } = data;

  const confirmPause = async () => {
    const active = paused; // dijeda -> lanjutkan (true); berjalan -> jeda (false)
    setPauseBusy(true);
    setPauseError(null);
    try {
      const res = await setAutopilotActive(active);
      patch((d) => ({ ...d, workspaceActive: res.active }));
      setPauseOpen(false);
    } catch (e) {
      setPauseError(e instanceof ContentApiError ? e.message : "Gagal mengubah saklar. Coba lagi.");
    } finally {
      setPauseBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader>
        <div className="flex flex-row-reverse sm:flex-col items-center sm:items-end justify-between gap-x-3 gap-y-1 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={paused}
            aria-label={paused ? "Lanjutkan autopilot (sedang dijeda untuk semua akun)" : "Jeda semua autopilot"}
            onClick={() => {
              setPauseError(null);
              setPauseOpen(true);
            }}
            className={cn(
              "shrink-0 h-10 pl-2.5 pr-4 rounded-full border bg-surface inline-flex items-center gap-2.5 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
              paused ? "border-danger text-danger" : "border-line-strong text-fg hover:border-accent"
            )}
          >
            <span className={cn("relative shrink-0 w-9 h-5 rounded-full transition-colors", paused ? "bg-danger" : "bg-line-strong")} aria-hidden>
              <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-surface transition-transform", paused && "translate-x-4")} />
            </span>
            {paused ? "Lanjutkan" : "Jeda semua"}
          </button>
          {health.lastRunAt && (
            <p className="text-xs text-muted tabular-nums">
              Tick <span className="max-sm:sr-only">terakhir </span>
              {timeOf(health.lastRunAt)} WIB{health.lastRunMs !== null ? `, ${health.lastRunMs} ms` : ""}
            </p>
          )}
        </div>
      </PageHeader>

      {/* Banner keadaan */}
      {error && (
        <Banner tone="danger">
          Gagal menyegarkan data: {error}{" "}
          <button type="button" onClick={() => void refetch()} className="underline font-semibold cursor-pointer">
            Coba lagi
          </button>
        </Banner>
      )}
      {!data.publishEnabled && (
        <Banner tone="warning">
          Saklar posting dashboard sedang mati. Autopilot tetap menyusun rencana, tetapi tidak menulis atau memposting apa pun.
        </Banner>
      )}
      {health.stale && (
        <Banner tone="warning">
          <p>
            {health.lastRunAt
              ? `Penjadwal terakhir berjalan ${durationText((loadedAt ?? Date.parse(health.lastRunAt)) - Date.parse(health.lastRunAt))} lalu. Autopilot tidak akan bekerja sampai penjadwal aktif lagi.`
              : "Penjadwal autopilot belum berjalan"}
          </p>
          {health.lastRunError && <p className="mt-1 text-danger">Galat tick terakhir: {health.lastRunError}</p>}
        </Banner>
      )}
      {!health.stale && health.lastRunError && <Banner tone="danger">Galat tick terakhir: {health.lastRunError}</Banner>}
      {paused && <Banner tone="danger">Autopilot sedang dijeda untuk semua akun.</Banner>}

      {/* Ringkasan */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          <SummaryTile label="Akun aktif" value={`${summary.active}/${summary.total}`} tone="accent" />
          <SummaryTile label="Slot hari ini" value={summary.slotsToday} />
          <SummaryTile label="Terbit hari ini" value={summary.publishedToday} tone="success" />
          <SummaryTile label="Perlu perhatian" value={summary.attention} tone={summary.attention > 0 ? "danger" : undefined} />
        </div>
      )}

      <AiPipeline slots={data.slots} today={data.today} paused={paused} handles={handles} />

      {/* Tab */}
      {/* Layar sempit: bar tab digeser di dalam barnya sendiri, halaman tidak ikut melebar. */}
      <div
        role="tablist"
        data-tour="autopilot-tabs"
        aria-label="Bagian autopilot"
        onKeyDown={onTabKey}
        className="flex gap-5 sm:gap-6 border-b border-line overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`autopilot-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`autopilot-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                "relative h-11 shrink-0 inline-flex items-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                active ? "text-accent" : "text-muted hover:text-fg"
              )}
            >
              {t.label}
              {t.key === "tinjau" && data.reviewCount > 0 && (
                <span
                  className={cn(
                    "min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center tabular-nums",
                    active ? "bg-accent text-on-accent" : "bg-warning-soft text-warning"
                  )}
                >
                  {data.reviewCount}
                  <span className="sr-only"> draf menunggu tinjauan</span>
                </span>
              )}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Panel tetap terpasang (isian tidak hilang saat pindah tab); efek, termasuk fetch, hanya jalan saat terlihat. */}
      <div>
        <Activity mode={tab === "akun" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-akun" aria-labelledby="autopilot-tab-akun">
            <AccountsTab data={data} loadedAt={loadedAt} refetch={refetch} patch={patch} />
          </div>
        </Activity>
        <Activity mode={tab === "rencana" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-rencana" aria-labelledby="autopilot-tab-rencana">
            <PlanTab data={data} active={tab === "rencana"} onRefresh={onStale} />
          </div>
        </Activity>
        <Activity mode={tab === "tinjau" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-tinjau" aria-labelledby="autopilot-tab-tinjau">
            <ReviewTab accounts={data.accounts} publishEnabled={data.publishEnabled} onResolved={onResolved} onStale={onStale} />
          </div>
        </Activity>
        <Activity mode={tab === "komentar" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-komentar" aria-labelledby="autopilot-tab-komentar">
            <RepliesTab active={tab === "komentar"} canManage />
          </div>
        </Activity>
        <Activity mode={tab === "riwayat" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-riwayat" aria-labelledby="autopilot-tab-riwayat">
            <HistoryTab accounts={data.accounts} />
          </div>
        </Activity>
        <Activity mode={tab === "affiliate" ? "visible" : "hidden"}>
          <div role="tabpanel" id="autopilot-panel-affiliate" aria-labelledby="autopilot-tab-affiliate">
            <AffiliateTab active={tab === "affiliate"} />
          </div>
        </Activity>
      </div>

      <ConfirmModal
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        onConfirm={confirmPause}
        busy={pauseBusy}
        error={pauseError}
        variant={paused ? "primary" : "danger"}
        title={paused ? "Lanjutkan autopilot?" : "Jeda autopilot untuk semua akun?"}
        confirmLabel={paused ? "Ya, lanjutkan" : "Ya, jeda semua"}
        confirmIcon={paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      >
        <p className="text-sm text-fg leading-relaxed">
          {paused
            ? "AI kembali menulis dan menjadwalkan posting untuk akun yang modenya Tinjau dulu atau Otomatis."
            : "AI berhenti menulis dan mengantrekan posting untuk semua akun sampai Anda melanjutkannya. Posting yang sudah masuk antrean tidak ikut dibatalkan."}
        </p>
      </ConfirmModal>
    </div>
  );
}

export default function AutopilotPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AutopilotInner />
    </Suspense>
  );
}
