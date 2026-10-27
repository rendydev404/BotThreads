"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { FleetSummaryCards } from "@/components/dashboard/fleet-summary-cards";
import { FleetLeaderboardTable } from "@/components/dashboard/fleet-leaderboard-table";
import { TopPerformingPostCard } from "@/components/dashboard/top-performing-post-card";
import { AiInsightPanel, type AiInsightPanelHandle } from "@/components/dashboard/ai-insight-panel";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { WeeklyActivityChart } from "@/components/dashboard/weekly-activity-chart";
import { PeriodFilter, periodLabelText, type PeriodValue } from "@/components/dashboard/period-filter";
import { RefreshCw, Sparkles } from "lucide-react";
import { useLang } from "@/components/i18n/lang-provider";
import type { TFunction } from "@/lib/i18n/core";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const fmtIso = (iso: string, t: TFunction) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${t(MONTHS[m - 1])}`;
};
const fmtTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const LIVE_REFRESH_MS = 60_000;

export default function DashboardPage() {
  const { t, locale } = useLang();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [period, setPeriod] = useState<PeriodValue>({ key: "7d" });
  const insightRef = useRef<AiInsightPanelHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOverviewData = useCallback(
    async (accountName: string, p: PeriodValue) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const qs = new URLSearchParams({ account: accountName, period: p.key });
      if (p.key === "custom" && p.from && p.to) {
        qs.set("from", p.from);
        qs.set("to", p.to);
      }

      try {
        const res = await fetch(`/api/analytics/overview?${qs}`, { signal: ctrl.signal });
        const json = await res.json();
        if (json.success) setData(json);
        setLoading(false);
        setRefreshing(false);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // diganti permintaan yang lebih baru
        console.error("Failed to load dashboard data:", err);
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchOverviewData(selectedAccount, period);
    return () => abortRef.current?.abort();
  }, [selectedAccount, period, fetchOverviewData]);

  // Periode yang mencakup hari ini: segarkan diam-diam tiap menit selama tab terlihat
  // (server menyimpan angka Threads 60 detik, jadi tidak menambah panggilan API)
  const isLive = Boolean(data?.period?.live);
  useEffect(() => {
    if (!isLive) return;
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < LIVE_REFRESH_MS - 1000) return;
      last = Date.now();
      fetchOverviewData(selectedAccount, period);
    };
    const id = window.setInterval(tick, LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isLive, selectedAccount, period, fetchOverviewData]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverviewData(selectedAccount, period);
  };

  const handleSelectAccount = (acc: string) => {
    setSelectedAccount(acc);
    setLoading(true);
  };

  const handlePeriod = (p: PeriodValue) => {
    setPeriod(p);
    setLoading(true);
  };

  const accounts = data?.accounts ?? [];
  const leaderboard = data?.leaderboard ?? [];
  const currentAccount = data?.currentAccount ?? {
    isAll: true,
    username: "all",
    displayName: "Seluruh jaringan",
  };
  const stats = data?.stats ?? {};
  const isAll = currentAccount.isAll;
  const accountCount = accounts.length || stats.activeAccounts || 32;
  const info = data?.period as
    | {
        label: string;
        from: string;
        to: string;
        days: number;
        hasPrev: boolean;
        live?: boolean;
        updatedAt?: string | null;
        liveFailed?: number;
      }
    | undefined;
  const initialLoad = loading && !data;
  const periodText = info ? periodLabelText(info.label, t) : "";
  const chartTitle = info
    ? info.days === 1
      ? t("Aktivitas {label} & 6 hari sebelumnya", { label: periodText.toLowerCase() })
      : t("Aktivitas {label}", { label: `${periodText.charAt(0).toLowerCase()}${periodText.slice(1)}` })
    : t("Aktivitas");

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-fg">{t("Performa Threads")}</h2>
          <p className="text-sm text-muted mt-1">
            {isAll
              ? t("Gabungan dari {n} akun yang Anda kelola.", { n: accountCount })
              : t("Menampilkan satu akun: @{username}.", { username: currentAccount.username })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <AccountFilterSelect
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={handleSelectAccount}
            totalAccounts={accountCount}
          />

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label={t("Perbarui data")}
            className="h-10 px-3.5 inline-flex items-center gap-2 rounded-lg bg-surface border border-line hover:border-line-strong text-sm font-medium text-fg cursor-pointer transition-colors disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 text-muted ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">{t("Perbarui")}</span>
          </button>

          <button
            type="button"
            onClick={() => insightRef.current?.run()}
            className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold cursor-pointer transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {t("Analisis AI")}
          </button>
        </div>
      </div>

      {/* Filter periode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <PeriodFilter value={period} onChange={handlePeriod} />
        {info && (
          <p className="text-[13px] text-muted">
            {info.live && (
              <span className="inline-flex items-center gap-1.5 mr-2 text-success font-medium">
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
                  <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
                </span>
                {t("Langsung")}
              </span>
            )}
            {info.from === info.to ? fmtIso(info.from, t) : `${fmtIso(info.from, t)} – ${fmtIso(info.to, t)}`}
            {info.live
              ? `${info.updatedAt ? ` · ${t("diperbarui {time} WIB", { time: fmtTime(info.updatedAt, locale) })}` : ""}${
                  info.liveFailed ? ` · ${t("{n} akun belum bisa diambil", { n: info.liveFailed })}` : ""
                }`
              : info.hasPrev
                ? ` · ${info.days === 1 ? t("dibanding sehari sebelumnya") : t("dibanding {n} hari sebelumnya", { n: info.days })}`
                : ` · ${t("belum ada data pembanding")}`}
          </p>
        )}
      </div>

      {/* Ringkasan angka */}
      <FleetSummaryCards
        loading={initialLoad}
        isAll={isAll}
        displayName={currentAccount.displayName}
        accountName={currentAccount.username || "all"}
        totalViews={stats.totalViews ?? 0}
        totalPosts={stats.totalPosts ?? 0}
        totalInteractions={stats.totalInteractions ?? 0}
        totalLikes={stats.totalLikes ?? 0}
        totalReplies={stats.totalReplies ?? 0}
        avgER={stats.avgER ?? 0}
        activeAccounts={stats.activeAccounts ?? accountCount}
        totalFollowers={stats.totalFollowers ?? currentAccount.followers ?? null}
        deltas={data?.deltas}
      />

      {/* Grafik + postingan terpopuler */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="card p-5 xl:col-span-2 flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
            <div>
              <h3 className="text-base font-semibold text-fg">{chartTitle}</h3>
              <p className="text-[13px] text-muted mt-0.5">
                {t("Penayangan dan interaksi per hari")}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                {t("Penayangan")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-success" />
                {t("Interaksi")}
              </span>
            </div>
          </div>

          {data ? (
            <div className={loading ? "opacity-50 transition-opacity" : "transition-opacity"}>
              <WeeklyActivityChart data={data.activity ?? []} />
            </div>
          ) : (
            <div className="h-64 sm:h-72 rounded-xl bg-subtle animate-pulse" />
          )}

          {/* Tombol analitik + saran AI di bawah grafik; mengisi ruang kosong kartu */}
          <div className="mt-auto">
            <AiInsightPanel
              ref={insightRef}
              account={selectedAccount}
              period={period}
              periodLabel={info ? periodText.toLowerCase() : undefined}
              scopeLabel={
                isAll ? t("Semua akun ({n})", { n: accountCount }) : `@${currentAccount.username}`
              }
            />
          </div>
        </section>

        <TopPerformingPostCard
          loading={initialLoad}
          topPost={data?.topPost}
          contentFormats={data?.contentFormats ?? []}
        />
      </div>

      {/* Peringkat + aktivitas bot */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <FleetLeaderboardTable
            accounts={leaderboard}
            loading={initialLoad}
            selectedAccount={selectedAccount}
            onSelectAccount={handleSelectAccount}
          />
        </div>
        <RecentActivityCard
          loading={initialLoad}
          activities={data?.recentBotActions}
        />
      </div>
    </div>
  );
}
