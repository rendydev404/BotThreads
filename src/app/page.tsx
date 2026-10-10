"use client";

import React, { useEffect, useState } from "react";
import { AccountFilterSelect } from "@/components/dashboard/account-filter-select";
import { AccountFleetHero } from "@/components/dashboard/account-fleet-hero";
import { AccountAnalysisModal } from "@/components/dashboard/account-analysis-modal";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { WeeklyActivityChart } from "@/components/dashboard/weekly-activity-chart";
import { FormatPieChart } from "@/components/dashboard/format-pie-chart";
import { EngagementSplineChart } from "@/components/dashboard/engagement-spline-chart";
import { TrendingUp, Layers, RefreshCw, BarChart2 } from "lucide-react";

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
    { name: "Video / Reels", value: 12, count: 197, color: "#16DBCC" },
    { name: "Foto / Promo", value: 2, count: 40, color: "#FF4B4A" },
    { name: "Carousel Edukasi", value: 1, count: 18, color: "#FFBB38" },
  ];

  const engagementHistory = data?.engagementHistory || [
    { month: "8 Sep", value: 2 },
    { month: "16 Sep", value: 3 },
    { month: "24 Sep", value: 1 },
    { month: "2 Okt", value: 9 },
    { month: "6 Okt", value: 21 },
    { month: "9 Okt", value: 25 },
  ];

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Top Filter & Operations Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-extrabold text-[#343C6A] tracking-tight">
            Threads Bot Analytics
          </h2>
          <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
            Monitoring performa real-time dan orkestrasi bot Telegram & Hermes AI
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
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white border border-[#EDF2F7] hover:border-[#1814F3]/30 text-xs font-semibold text-[#343C6A] hover:bg-[#F4F7FE] shadow-xs cursor-pointer transition-all"
            title="Perbarui Data"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#1814F3] ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="hidden md:inline">
              {refreshing ? "Memperbarui..." : "Perbarui"}
            </span>
          </button>
        </div>
      </div>

      {/* Row 1: Executive Fleet Hero Deck (No Fake Bank Cards) */}
      <AccountFleetHero
        isAll={currentAccount.isAll}
        accountName={currentAccount.username || "all"}
        displayName={currentAccount.displayName}
        avatarUrl={currentAccount.avatarUrl}
        totalViews={stats.totalViews}
        totalPosts={stats.totalPosts}
        totalInteractions={stats.totalInteractions}
        totalLikes={stats.totalLikes}
        totalReplies={stats.totalReplies}
        totalReposts={stats.totalReposts}
        avgER={stats.avgER}
        topPost={data?.topPost}
        onOpenAnalysis={() => setIsAnalysisModalOpen(true)}
      />

      {/* Row 2: Weekly Activity & Content Format Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Weekly Activity Bar Chart */}
        <div className="lg:col-span-8 neo-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[#1814F3]" />
                <h3 className="text-base font-bold text-[#343C6A]">
                  Weekly Activity
                </h3>
              </div>
              <p className="text-xs text-[#718EBF] mt-0.5">
                {currentAccount.isAll
                  ? "Akumulasi impresi dan interaksi seluruh jaringan akun 7 hari terakhir"
                  : `Impresi dan interaksi @${currentAccount.username} 7 hari terakhir`}
              </p>
            </div>

            {/* Chart Legend */}
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1814F3]" />
                <span className="text-[#718EBF]">Views</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#16DBCC]" />
                <span className="text-[#718EBF]">Interaksi</span>
              </div>
            </div>
          </div>
          <WeeklyActivityChart data={weeklyActivity} />
        </div>

        {/* Content Format Stats Donut Chart */}
        <div className="lg:col-span-4 neo-card p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-bold text-[#343C6A]">
              Content Format Stats
            </h3>
            <Layers className="w-4 h-4 text-[#718EBF]" />
          </div>
          <FormatPieChart data={contentFormats} />
        </div>
      </div>

      {/* Row 3: Engagement History & Recent Bot Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 neo-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#343C6A]">
                Engagement History
              </h3>
              <p className="text-xs text-[#718EBF]">
                Tren pertumbuhan penayangan (views) dari database berkala
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#10B981] font-bold bg-[#10B981]/10 px-2.5 py-1 rounded-full">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Real DB Curve</span>
            </div>
          </div>
          <EngagementSplineChart data={engagementHistory} />
        </div>

        <div className="lg:col-span-4">
          <RecentActivityCard activities={data?.recentBotActions} />
        </div>
      </div>

      {/* Interactive Hermes AI Account Analysis Modal */}
      <AccountAnalysisModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        account={selectedAccount}
        accountLabel={currentAccount.displayName}
      />
    </div>
  );
}
