"use client";

import React, { useState, useEffect } from "react";
import { WeeklyActivityChart } from "@/components/dashboard/weekly-activity-chart";
import { FormatPieChart } from "@/components/dashboard/format-pie-chart";
import { EngagementSplineChart } from "@/components/dashboard/engagement-spline-chart";
import {
  TrendingUp,
  BarChart3,
  Users,
  Eye,
  MessageCircle,
  Share2,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch("/api/analytics/overview")
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setData(json);
      })
      .catch((err) => console.error(err));
  }, []);

  const stats = data?.stats || {
    totalViews: 184200,
    avgER: 5.2,
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
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          Performance Analytics & Insights
        </h2>
        <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
          Rincian analitik performa akun Threads, engagement benchmark, dan pola perilaku audiens
        </p>
      </div>

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#718EBF]">Total Views</span>
            <div className="w-8 h-8 rounded-xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#343C6A]">
            {formatNumber(stats.totalViews)}
          </h3>
          <p className="text-[11px] text-[#16DBCC] font-semibold mt-1">
            +12.4% dari pekan lalu
          </p>
        </div>

        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#718EBF]">Average ER</span>
            <div className="w-8 h-8 rounded-xl bg-[#16DBCC]/10 text-[#16DBCC] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#343C6A]">
            {stats.avgER}%
          </h3>
          <p className="text-[11px] text-[#16DBCC] font-semibold mt-1">
            Diatas rata-rata industri
          </p>
        </div>

        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#718EBF]">Total Interaksi</span>
            <div className="w-8 h-8 rounded-xl bg-[#FFBB38]/15 text-[#FFBB38] flex items-center justify-center">
              <MessageCircle className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#343C6A]">
            9,580
          </h3>
          <p className="text-[11px] text-[#1814F3] font-semibold mt-1">
            Likes, replies & reposts
          </p>
        </div>

        <div className="neo-card p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#718EBF]">Shares & Quotes</span>
            <div className="w-8 h-8 rounded-xl bg-[#FF4B4A]/10 text-[#FF4B4A] flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-[#343C6A]">
            1,240
          </h3>
          <p className="text-[11px] text-[#718EBF] font-medium mt-1">
            Penyebaran organik
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 neo-card p-6">
          <h3 className="text-base font-bold text-[#343C6A] mb-4">
            Aktivitas Mingguan (Views vs Interaksi)
          </h3>
          <WeeklyActivityChart data={weeklyActivity} />
        </div>

        <div className="lg:col-span-4 neo-card p-6">
          <h3 className="text-base font-bold text-[#343C6A] mb-4">
            Distribusi Format Konten
          </h3>
          <FormatPieChart data={contentFormats} />
        </div>

        <div className="lg:col-span-12 neo-card p-6">
          <h3 className="text-base font-bold text-[#343C6A] mb-4">
            Tren Pertumbuhan Engagement 7 Bulan Terakhir
          </h3>
          <EngagementSplineChart data={engagementHistory} />
        </div>
      </div>
    </div>
  );
}
