"use client";

import React, { useEffect, useState } from "react";
import { HeroAccountCards } from "@/components/dashboard/hero-account-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { WeeklyActivityChart } from "@/components/dashboard/weekly-activity-chart";
import { FormatPieChart } from "@/components/dashboard/format-pie-chart";
import { QuickPromptCard } from "@/components/dashboard/quick-prompt-card";
import { EngagementSplineChart } from "@/components/dashboard/engagement-spline-chart";
import { Sparkles, BarChart3, TrendingUp, Layers, RefreshCw } from "lucide-react";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverviewData = async () => {
    try {
      const res = await fetch("/api/analytics/overview");
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
    fetchOverviewData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOverviewData();
  };

  const stats = data?.stats || {
    totalViews: 184200,
    avgER: 5.2,
    primaryAccount: "sukashawarma",
    maskedCardId: "7194 **** **** 8820",
    secondaryCardId: "5542 **** **** 1234",
  };

  const weeklyActivity = data?.weeklyActivity || [
    { day: "Sab", views: 380, interactions: 220 },
    { day: "Min", views: 420, interactions: 310 },
    { day: "Sen", views: 290, interactions: 180 },
    { day: "Sel", views: 480, interactions: 350 },
    { day: "Rab", views: 360, interactions: 240 },
    { day: "Kam", views: 410, interactions: 290 },
    { day: "Jum", views: 490, interactions: 380 },
  ];

  const contentFormats = data?.contentFormats || [
    { name: "Teks Singkat", value: 35, count: 18, color: "#1814F3" },
    { name: "Video / Reels", value: 30, count: 15, color: "#16DBCC" },
    { name: "Carousel Edukasi", value: 20, count: 10, color: "#FFBB38" },
    { name: "Foto / Promo", value: 15, count: 8, color: "#FF4B4A" },
  ];

  const engagementHistory = data?.engagementHistory || [
    { month: "Jul", value: 150 },
    { month: "Agu", value: 280 },
    { month: "Sep", value: 210 },
    { month: "Okt", value: 490 },
    { month: "Nov", value: 320 },
    { month: "Des", value: 680 },
    { month: "Jan", value: 590 },
  ];

  return (
    <div className="space-y-7">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
            Threads Bot Analytics
          </h2>
          <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
            Monitoring performa real-time dan orkestrasi bot Telegram & Hermes AI
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-[#EDF2F7] text-xs font-semibold text-[#343C6A] hover:bg-[#F4F7FE] shadow-xs cursor-pointer transition-colors"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-[#1814F3] ${refreshing ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">
            {refreshing ? "Memperbarui..." : "Perbarui Data"}
          </span>
        </button>
      </div>

      {/* Row 1: My Accounts Hero Cards (Left) & Recent Bot Activity (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-3.5">
            <h3 className="text-lg font-bold text-[#343C6A]">My Accounts</h3>
            <span className="text-xs text-[#1814F3] font-semibold hover:underline cursor-pointer">
              + Tambah Akun
            </span>
          </div>
          <HeroAccountCards
            totalViews={stats.totalViews}
            avgER={stats.avgER}
            primaryAccount={stats.primaryAccount}
            maskedCardId={stats.maskedCardId}
            secondaryCardId={stats.secondaryCardId}
          />
        </div>

        <div className="lg:col-span-4 flex flex-col">
          <div className="h-7 mb-3.5" />
          <div className="flex-1">
            <RecentActivityCard activities={data?.recentBotActions} />
          </div>
        </div>
      </div>

      {/* Row 2: Weekly Activity (Left) & Content Format Stats (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 neo-card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div>
              <h3 className="text-base font-bold text-[#343C6A]">
                Weekly Activity
              </h3>
              <p className="text-xs text-[#718EBF]">
                Perbandingan impresi penayangan dan jumlah interaksi per hari
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

      {/* Row 3: Quick AI Prompt (Left) & Engagement History (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5">
          <QuickPromptCard />
        </div>

        <div className="lg:col-span-7 neo-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#343C6A]">
                Engagement History
              </h3>
              <p className="text-xs text-[#718EBF]">
                Tren pertumbuhan interaksi audiens 7 bulan terakhir
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#16DBCC] font-bold bg-[#16DBCC]/10 px-2.5 py-1 rounded-full">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>+38.5% YTD</span>
            </div>
          </div>
          <EngagementSplineChart data={engagementHistory} />
        </div>
      </div>
    </div>
  );
}
