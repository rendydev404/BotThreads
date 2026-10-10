"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import {
  Sparkles,
  TrendingUp,
  MessageSquare,
  Heart,
  Repeat,
  Radio,
  ExternalLink,
  ShieldCheck,
  Zap,
} from "lucide-react";

interface AccountFleetHeroProps {
  isAll: boolean;
  accountName: string;
  displayName: string;
  avatarUrl: string | null;
  totalViews: number;
  totalPosts: number;
  totalInteractions: number;
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  avgER: number;
  topPost?: {
    text: string;
    views: number;
    likes: number;
    replies: number;
    mediaType?: string;
    permalink?: string | null;
  } | null;
  onOpenAnalysis: () => void;
}

export function AccountFleetHero({
  isAll,
  accountName,
  displayName,
  avatarUrl,
  totalViews,
  totalPosts,
  totalInteractions,
  totalLikes,
  totalReplies,
  totalReposts,
  avgER,
  topPost,
  onOpenAnalysis,
}: AccountFleetHeroProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Primary Scope Card: Deep Electric Blue with High-Contrast White */}
      <div className="lg:col-span-7 rounded-3xl bg-[#1814F3] text-white p-6 sm:p-7 shadow-lg shadow-[#1814F3]/15 flex flex-col justify-between min-h-[220px]">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-[11px] font-semibold backdrop-blur-xs mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
              <span>
                {isAll
                  ? "Seluruh Jaringan (32 Akun Terhubung)"
                  : "Akun Terverifikasi"}
              </span>
            </div>
            <p className="text-xs uppercase tracking-wider text-white/70 font-semibold">
              {isAll ? "Total Impresi Akumulasi Jaringan" : "Total Penayangan Akun"}
            </p>
            <h3 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mt-1">
              {formatNumber(totalViews)}{" "}
              <span className="text-base sm:text-lg font-medium text-white/80">
                Views
              </span>
            </h3>
          </div>

          {/* Avatar or Fleet Icon */}
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 overflow-hidden flex items-center justify-center shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center font-black text-xl text-white">
                {isAll ? "32" : displayName.slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Footer Row: Account Details & Direct AI Analysis Trigger */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-5 mt-4 border-t border-white/15">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <span className="block text-sm font-bold text-white truncate max-w-[220px]">
                {displayName}
              </span>
              <span className="block text-xs text-white/70">
                {isAll ? "32 Akun Outlet Terkoneksi" : `@${accountName}`} •{" "}
                <span className="font-semibold text-white">
                  {totalPosts} Postingan
                </span>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAnalysis}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-white text-[#1814F3] hover:bg-[#F4F7FE] active:scale-98 text-xs font-bold shadow-md cursor-pointer transition-all shrink-0"
          >
            <Sparkles className="w-4 h-4 text-[#1814F3]" />
            <span>
              {isAll ? "Analisis Semua Akun" : "Analisis Akun Ini"}
            </span>
          </button>
        </div>
      </div>

      {/* Secondary Benchmark & Performance Card: Clean Porcelain Surface */}
      <div className="lg:col-span-5 rounded-3xl bg-white text-[#343C6A] p-6 sm:p-7 border border-[#EDF2F7] shadow-xs flex flex-col justify-between min-h-[220px]">
        {/* Top Header: Engagement Rate */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-[#718EBF] font-semibold">
              Engagement Rate & Rasio
            </span>
            <span className="text-xs font-bold text-[#10B981] bg-[#10B981]/10 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5" />
              {avgER >= 4 ? "Sangat Aktif" : "Normal"}
            </span>
          </div>

          <div className="flex items-baseline gap-3 mt-1.5">
            <h4 className="text-3xl font-extrabold tracking-tight text-[#343C6A]">
              {avgER}%
            </h4>
            <span className="text-xs text-[#718EBF]">
              dari {formatNumber(totalInteractions)} interaksi
            </span>
          </div>

          {/* Interactions Breakdown Pill Bar */}
          <div className="grid grid-cols-3 gap-2 mt-3.5">
            <div className="p-2.5 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-[#718EBF] mb-0.5 font-medium">
                <Heart className="w-3 h-3 text-[#FF4B4A]" /> Likes
              </div>
              <span className="text-xs font-bold text-[#343C6A]">
                {formatNumber(totalLikes)}
              </span>
            </div>

            <div className="p-2.5 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-[#718EBF] mb-0.5 font-medium">
                <MessageSquare className="w-3 h-3 text-[#1814F3]" /> Replies
              </div>
              <span className="text-xs font-bold text-[#343C6A]">
                {formatNumber(totalReplies)}
              </span>
            </div>

            <div className="p-2.5 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
              <div className="flex items-center justify-center gap-1 text-[11px] text-[#718EBF] mb-0.5 font-medium">
                <Repeat className="w-3 h-3 text-[#16DBCC]" /> Reposts
              </div>
              <span className="text-xs font-bold text-[#343C6A]">
                {formatNumber(totalReposts)}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Snippet: Top Post or Quick System Status */}
        <div className="pt-3 mt-3 border-t border-[#EDF2F7]">
          {topPost ? (
            <div className="flex items-center justify-between text-xs">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] uppercase font-bold text-[#1814F3] block">
                  Postingan Teratas
                </span>
                <p className="text-xs text-[#343C6A] font-medium truncate">
                  "{topPost.text?.slice(0, 50) || "Postingan media"}"
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs font-bold text-[#1814F3]">
                  {formatNumber(topPost.views)} views
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs text-[#718EBF]">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
                Bot Auto Comment Aktif
              </span>
              <span className="font-semibold text-[#1814F3]">
                Auto Sync 24/7
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
