"use client";

import React from "react";
import { Send, RefreshCw, Bot } from "lucide-react";

interface ActivityItem {
  id: string;
  title?: string;
  desc?: string;
  status: string;
  createdAt: string;
}

interface RecentActivityCardProps {
  activities?: ActivityItem[];
}

export function RecentActivityCard({
  activities = [],
}: RecentActivityCardProps) {
  const displayItems =
    activities && activities.length > 0
      ? activities.slice(0, 3)
      : [
          {
            id: "1",
            title: "Laporan Harian Telegram",
            desc: "Ringkasan metrik harian terkirim ke tim",
            status: "SENT",
            createdAt: "2026-10-10T08:00:00.000Z",
          },
          {
            id: "2",
            title: "Sinkronisasi Metrik Database",
            desc: "1.680 postingan Threads tersinkron otomatis",
            status: "SENT",
            createdAt: "2026-10-10T07:30:00.000Z",
          },
          {
            id: "3",
            title: "Status Bot & Orkestrasi",
            desc: "Engine Gemini 3.8 Flash & Telegram aktif",
            status: "ACTIVE",
            createdAt: "2026-10-10T07:00:00.000Z",
          },
        ];

  return (
    <div className="bg-white dark:bg-[#111827] border border-[#E2E8F0] dark:border-[#1F2937] rounded-2xl p-5 shadow-xs flex flex-col justify-between transition-colors">
      <div className="flex items-center justify-between pb-3.5 border-b border-[#F1F5F9] dark:border-[#1F2937] mb-4">
        <div>
          <h4 className="text-xs font-bold text-[#1E293B] dark:text-[#F8FAFC]">
            Aktivitas Bot & Sinkronisasi
          </h4>
          <p className="text-[10px] text-[#64748B] dark:text-[#94A3B8]">
            Log eksekusi dan laporan otomatis
          </p>
        </div>
        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Real-time</span>
        </span>
      </div>

      <div className="space-y-3.5">
        {displayItems.map((item, index) => {
          const isFirst = index === 0;
          const isSecond = index === 1;

          return (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B]/60 border border-[#F1F5F9] dark:border-[#1F2937]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isFirst
                      ? "bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
                      : isSecond
                      ? "bg-blue-50 dark:bg-blue-950/50 text-[#1814F3] dark:text-blue-400"
                      : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  {isFirst ? (
                    <Send className="w-4 h-4" />
                  ) : isSecond ? (
                    <RefreshCw className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1E293B] dark:text-[#F8FAFC] truncate">
                    {item.title}
                  </p>
                  <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
                    {item.desc}
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md shrink-0 border border-emerald-200 dark:border-emerald-800">
                {item.status === "ACTIVE" ? "Aktif" : "Sukses"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
