"use client";

import React from "react";
import { Send, RefreshCw, MessageSquare, CheckCircle2 } from "lucide-react";
import { formatDateWIB } from "@/lib/utils";

interface ActivityItem {
  id: string;
  targetAuthor?: string;
  targetText?: string;
  status: string;
  keyword?: string;
  createdAt: string;
}

interface RecentActivityCardProps {
  activities?: ActivityItem[];
}

export function RecentActivityCard({ activities = [] }: RecentActivityCardProps) {
  const displayItems =
    activities.length > 0
      ? activities.slice(0, 3)
      : [
          {
            id: "1",
            type: "report",
            title: "Laporan Harian Terkirim",
            desc: "Pesan rekap terkirim ke Telegram Group",
            amount: "+100%",
            color: "yellow",
          },
          {
            id: "2",
            type: "sync",
            title: "Sync Metrik Postingan",
            desc: "12 postingan Threads tersinkronisasi",
            amount: "12 Post",
            color: "blue",
          },
          {
            id: "3",
            type: "comment",
            title: "Auto-Komentar Terkirim",
            desc: "Balasan otomatis ke @kuliner_sby",
            amount: "1 Sent",
            color: "teal",
          },
        ];

  return (
    <div className="neo-card p-6 flex flex-col justify-between h-full">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-bold text-[#343C6A]">
          Recent Bot Activity
        </h4>
        <span className="text-xs text-[#1814F3] font-semibold cursor-pointer hover:underline">
          Lihat Semua
        </span>
      </div>

      <div className="space-y-4">
        {/* Item 1: Yellow/Amber Circle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#FFF5D9] flex items-center justify-center text-[#FFBB38] shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">
                Laporan Harian Terkirim
              </p>
              <p className="text-xs text-[#718EBF]">
                Telegram Bot Master Konten
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[#16DBCC]">Sukses</span>
        </div>

        {/* Item 2: Soft Blue Circle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#E7EDFF] flex items-center justify-center text-[#1814F3] shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">
                Sync Metrik & Insights
              </p>
              <p className="text-xs text-[#718EBF]">
                Database Supabase PostgreSQL
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[#1814F3]">12 Post</span>
        </div>

        {/* Item 3: Mint Teal Circle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-[#DCFAF8] flex items-center justify-center text-[#16DBCC] shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">
                Auto-Komentar Terkirim
              </p>
              <p className="text-xs text-[#718EBF]">
                {activities[0]?.targetAuthor
                  ? `@${activities[0].targetAuthor}`
                  : "Target keyword 'shawarma'"}
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-[#16DBCC]">Aktif</span>
        </div>
      </div>
    </div>
  );
}
