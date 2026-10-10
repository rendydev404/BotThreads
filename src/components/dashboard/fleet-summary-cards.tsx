"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import { Users, Eye, FileText, TrendingUp, Sparkles, CheckCircle2 } from "lucide-react";

interface FleetSummaryCardsProps {
  isAll: boolean;
  displayName: string;
  accountName: string;
  totalViews: number;
  totalPosts: number;
  totalInteractions: number;
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  avgER: number;
  activeAccounts: number;
  onOpenAnalysis: () => void;
}

export function FleetSummaryCards({
  isAll,
  displayName,
  accountName,
  totalViews,
  totalPosts,
  totalInteractions,
  totalLikes,
  totalReplies,
  avgER,
  activeAccounts,
  onOpenAnalysis,
}: FleetSummaryCardsProps) {
  const cards = [
    {
      title: isAll ? "Total Akun Jaringan" : "Akun Terpilih",
      value: isAll ? `${activeAccounts} Akun` : `@${accountName}`,
      subtitle: isAll ? "Seluruh cabang terhubung aktif" : displayName,
      icon: Users,
      badgeText: isAll ? "32 Cabang Aktif" : "Cabang Spesifik",
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconBg: "bg-slate-100 text-slate-700",
    },
    {
      title: "Total Penayangan (Views)",
      value: formatNumber(totalViews),
      subtitle: "Akumulasi impresi pembaca Threads",
      icon: Eye,
      badgeText: "Jangkauan Luas",
      badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
      iconBg: "bg-blue-50 text-[#1814F3]",
    },
    {
      title: "Total Postingan Terbit",
      value: formatNumber(totalPosts),
      subtitle: "Konten aktif dipublikasikan",
      icon: FileText,
      badgeText: "Produktivitas Tinggi",
      badgeColor: "bg-indigo-50 text-indigo-700 border-indigo-200",
      iconBg: "bg-indigo-50 text-indigo-600",
    },
    {
      title: "Rasio Interaksi (ER)",
      value: `${avgER}%`,
      subtitle: `${formatNumber(totalInteractions)} interaksi (${totalLikes} suka, ${totalReplies} komentar)`,
      icon: TrendingUp,
      badgeText: avgER >= 1.0 ? "Sangat Aktif" : "Stabil",
      badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      iconBg: "bg-emerald-50 text-emerald-600",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Scope Status Banner */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5 text-[#1814F3]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#718EBF] uppercase tracking-wider">
                Mode Tampilan Data:
              </span>
              <span className="text-xs font-extrabold text-[#1814F3] bg-[#1814F3]/10 px-2 py-0.5 rounded-md">
                {isAll ? "Seluruh Jaringan (32 Akun)" : `@${accountName}`}
              </span>
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">
              {isAll
                ? "Menampilkan ringkasan total performa dari seluruh 32 akun cabang Suka Shawarma yang tersinkronisasi."
                : `Menampilkan performa spesifik outlet ${displayName}.`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenAnalysis}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1814F3] hover:bg-[#120ec0] text-white text-xs font-bold shadow-xs cursor-pointer transition-all shrink-0"
        >
          <Sparkles className="w-4 h-4 text-white" />
          <span>Analisis Cerdas AI</span>
        </button>
      </div>

      {/* 4 Clean Metric KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-xs hover:border-[#CBD5E1] transition-all flex flex-col justify-between"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-[#64748B] block truncate">
                    {card.title}
                  </span>
                  <h3 className="text-2xl font-extrabold text-[#1E293B] tracking-tight mt-1 truncate">
                    {card.value}
                  </h3>
                </div>
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${card.iconBg}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[#F1F5F9] flex items-center justify-between text-[11px]">
                <span className="text-[#64748B] truncate max-w-[170px]" title={card.subtitle}>
                  {card.subtitle}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold shrink-0 ${card.badgeColor}`}
                >
                  {card.badgeText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
