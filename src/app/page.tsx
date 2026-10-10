"use client";

import React, { useEffect, useState } from "react";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { FleetSummaryCards } from "@/components/dashboard/fleet-summary-cards";
import { FleetLeaderboardTable } from "@/components/dashboard/fleet-leaderboard-table";
import { TopPerformingPostCard } from "@/components/dashboard/top-performing-post-card";
import { AccountAnalysisModal } from "@/components/dashboard/account-analysis-modal";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { WeeklyActivityChart } from "@/components/dashboard/weekly-activity-chart";
import { BarChart2, RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);

  const fetchOverviewData = async (accountName = selectedAccount) => {
    try {
      const res = await fetch(
        `/api/analytics/overview?account=${encodeURIComponent(accountName)}`
      );
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOverviewData(selectedAccount);
  }, [selectedAccount]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverviewData(selectedAccount);
  };

  const handleSelectAccount = (acc: string) => {
    setSelectedAccount(acc);
    setLoading(true);
  };

  const accounts = data?.accounts || [];
  const leaderboard = data?.leaderboard || [];
  const currentAccount = data?.currentAccount || {
    isAll: true,
    username: "all",
    displayName: "Semua Akun (32 Terhubung)",
    avatarUrl: null,
    totalPosts: 1680,
  };

  const stats = data?.stats || {
    totalViews: 193720,
    totalPosts: 1680,
    totalInteractions: 917,
    totalLikes: 407,
    totalReplies: 497,
    totalReposts: 13,
    avgER: 0.5,
    activeAccounts: 32,
  };

  const weeklyActivity = data?.weeklyActivity || [
    { day: "Sab", views: 6851, interactions: 80 },
    { day: "Min", views: 7815, interactions: 34 },
    { day: "Sen", views: 9570, interactions: 61 },
    { day: "Sel", views: 20846, interactions: 96 },
    { day: "Rab", views: 29265, interactions: 137 },
    { day: "Kam", views: 24156, interactions: 168 },
    { day: "Jum", views: 24963, interactions: 84 },
  ];

  const contentFormats = data?.contentFormats || [
    { name: "Teks Singkat", value: 85, count: 1425, color: "#1814F3" },
    { name: "Video / Reels", value: 12, count: 197, color: "#10B981" },
    { name: "Foto / Promo", value: 2, count: 40, color: "#F59E0B" },
    { name: "Carousel Edukasi", value: 1, count: 18, color: "#6366F1" },
  ];

  return (
    <div className="space-y-6 sm:space-y-7 pb-12 transition-colors">
      {/* Top Header & Account Selection Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-extrabold text-[#1E293B] dark:text-[#F8FAFC] tracking-tight">
            Performa Akun Threads
          </h2>
          <p className="text-xs md:text-sm text-[#64748B] dark:text-[#94A3B8] mt-0.5">
            Pantau penayangan, postingan, dan efektivitas 32 akun cabang Suka Shawarma secara real-time.
          </p>
        </div>

        {/* Custom Account Dropdown Filter & Refresh Button */}
        <div className="flex items-center gap-3">
          <AccountFilterSelect
            accounts={accounts}
            selectedAccount={selectedAccount}
            onSelectAccount={handleSelectAccount}
            totalAccounts={accounts.length || 32}
          />

          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#111827] border border-[#E2E8F0] dark:border-[#1F2937] hover:border-[#1814F3]/40 dark:hover:border-blue-400/40 text-xs font-semibold text-[#1E293B] dark:text-[#F8FAFC] hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B] shadow-xs cursor-pointer transition-all"
            title="Perbarui Data"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#1814F3] dark:text-blue-400 ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">
              {refreshing ? "Memperbarui..." : "Perbarui"}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1: Clean Executive Fleet Summary (4 KPI Cards + Scope Banner) */}
      <FleetSummaryCards
        isAll={currentAccount.isAll}
        displayName={currentAccount.displayName}
        accountName={currentAccount.username || "all"}
        totalViews={stats.totalViews}
        totalPosts={stats.totalPosts}
        totalInteractions={stats.totalInteractions}
        totalLikes={stats.totalLikes}
        totalReplies={stats.totalReplies}
        totalReposts={stats.totalReposts}
        avgER={stats.avgER}
        activeAccounts={stats.activeAccounts || 32}
        onOpenAnalysis={() => setIsAnalysisModalOpen(true)}
      />

      {/* Row 2: Analytics Grid (Chart + Top Post) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (8 cols): Weekly Activity Bar Chart */}
        <div className="lg:col-span-8 bg-white dark:bg-[#111827] border border-[#E2E8F0] dark:border-[#1F2937] rounded-2xl p-6 shadow-xs flex flex-col justify-between transition-colors">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#1814F3] dark:text-blue-400 flex items-center justify-center">
                  <BarChart2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#1E293B] dark:text-[#F8FAFC]">
                    Aktivitas Penayangan 7 Hari Terakhir
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-[#94A3B8]">
                    {currentAccount.isAll
                      ? "Akumulasi impresi dan interaksi seluruh 32 akun cabang"
                      : `Statistik 7 hari akun @${currentAccount.username}`}
                  </p>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-xs font-semibold">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1814F3] dark:bg-blue-500" />
                <span className="text-[#64748B] dark:text-[#94A3B8]">Views</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                <span className="text-[#64748B] dark:text-[#94A3B8]">Interaksi</span>
              </div>
            </div>
          </div>

          <WeeklyActivityChart data={weeklyActivity} />
        </div>

        {/* Right Column (4 cols): Top Performing Post & Content Format Progress */}
        <div className="lg:col-span-4">
          <TopPerformingPostCard
            topPost={data?.topPost}
            contentFormats={contentFormats}
          />
        </div>
      </div>

      {/* Row 3: Fleet Leaderboard Table & Recent Sync Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 32-Account Leaderboard Table (8 cols) */}
        <div className="lg:col-span-8">
          <FleetLeaderboardTable
            accounts={leaderboard}
            selectedAccount={selectedAccount}
            onSelectAccount={handleSelectAccount}
            onOpenAnalysis={() => setIsAnalysisModalOpen(true)}
          />
        </div>

        {/* Telegram & System Sync Logs (4 cols) */}
        <div className="lg:col-span-4">
          <RecentActivityCard activities={data?.recentBotActions} />
        </div>
      </div>

      {/* Interactive AI Account Analysis Modal */}
      <AccountAnalysisModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        account={selectedAccount}
        accountLabel={currentAccount.displayName}
      />
    </div>
  );
}
