"use client";

import React from "react";
import { formatNumber } from "@/lib/utils";
import { Radio, ArrowUpRight, Cpu } from "lucide-react";

interface HeroAccountCardProps {
  totalViews: number;
  avgER: number;
  primaryAccount: string;
  maskedCardId?: string;
  secondaryCardId?: string;
}

export function HeroAccountCards({
  totalViews,
  avgER,
  primaryAccount,
  maskedCardId = "7194 **** **** 8820",
  secondaryCardId = "5542 **** **** 1234",
}: HeroAccountCardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {/* Primary Card: Electric Cobalt Blue (BankFlash Hero) */}
      <div className="relative overflow-hidden rounded-3xl bg-[#1814F3] text-white p-6 sm:p-7 shadow-xl shadow-[#1814F3]/20 flex flex-col justify-between min-h-[210px]">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs uppercase tracking-wider text-white/70 font-semibold">
              Total Impresi (7 Hari)
            </span>
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mt-1">
              {formatNumber(totalViews)}
            </h3>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-xs">
            <Radio className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Card Middle: Account & Status */}
        <div className="flex items-center gap-6 my-2 text-xs text-white/80">
          <div>
            <span className="block text-[10px] uppercase text-white/60">
              Akun Utama
            </span>
            <span className="font-semibold text-white">@{primaryAccount}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-white/60">
              Bot Status
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Aktif Sync
            </span>
          </div>
        </div>

        {/* Card Footer: Masked ID + Design Circles */}
        <div className="flex items-center justify-between pt-3 border-t border-white/15">
          <span className="font-mono text-base tracking-widest text-white/90">
            {maskedCardId}
          </span>
          {/* BankFlash Dual Interlocking Circles Accent */}
          <div className="flex -space-x-3 opacity-80">
            <div className="w-8 h-8 rounded-full bg-white/30" />
            <div className="w-8 h-8 rounded-full bg-white/20" />
          </div>
        </div>
      </div>

      {/* Secondary Card: Clean White Card (Avg ER & Benchmark) */}
      <div className="relative overflow-hidden rounded-3xl bg-white text-[#343C6A] p-6 sm:p-7 border border-[#EDF2F7] shadow-sm flex flex-col justify-between min-h-[210px]">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs uppercase tracking-wider text-[#718EBF] font-semibold">
              Rata-rata Engagement
            </span>
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#343C6A] mt-1 flex items-baseline gap-2">
              {avgER}% ER
              <span className="text-xs font-semibold text-[#16DBCC] bg-[#16DBCC]/10 px-2 py-0.5 rounded-full inline-flex items-center gap-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" /> +1.4%
              </span>
            </h3>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-[#F5F7FA] flex items-center justify-center text-[#718EBF]">
            <Cpu className="w-6 h-6 text-[#1814F3]" />
          </div>
        </div>

        {/* Card Middle: Benchmark & Ratio */}
        <div className="flex items-center gap-6 my-2 text-xs">
          <div>
            <span className="block text-[10px] uppercase text-[#718EBF]">
              Benchmark F&B
            </span>
            <span className="font-semibold text-[#343C6A]">3.8% – 4.5%</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase text-[#718EBF]">
              Kualitas Interaksi
            </span>
            <span className="font-semibold text-[#1814F3]">High Performer</span>
          </div>
        </div>

        {/* Card Footer: Masked ID + Subdued Circles */}
        <div className="flex items-center justify-between pt-3 border-t border-[#EDF2F7]">
          <span className="font-mono text-base tracking-widest text-[#718EBF]">
            {secondaryCardId}
          </span>
          <div className="flex -space-x-3 opacity-40">
            <div className="w-8 h-8 rounded-full bg-[#718EBF]" />
            <div className="w-8 h-8 rounded-full bg-[#718EBF]/50" />
          </div>
        </div>
      </div>
    </div>
  );
}
