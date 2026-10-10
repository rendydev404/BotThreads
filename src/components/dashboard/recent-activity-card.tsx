"use client";

import React from "react";
import { Send, RefreshCw, MessageSquare, CheckCircle2 } from "lucide-react";
import { formatDateWIB } from "@/lib/utils";

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

export function RecentActivityCard({ activities = [] }: RecentActivityCardProps) {
  const displayItems =
    activities && activities.length > 0
      ? activities.slice(0, 3)
      : [
          {
            id: "1",
            title: "Laporan Harian Telegram",
            desc: "Periode: 2026-10-10 terkirim sukses",
            status: "SENT",
            createdAt: "2026-10-10T01:09:55.798Z",
          },
          {
            id: "2",
            title: "Sync Metrik Postingan",
            desc: "1,680 postingan Threads tersinkronisasi",
            status: "SENT",
            createdAt: "2026-10-09T22:10:03.617Z",
          },
          {
            id: "3",
            title: "Auto-Komentar Threads",
            desc: "Slot jadwal WIB & guardrail aktif",
            status: "ACTIVE",
            createdAt: "2026-10-09T18:30:00.000Z",
          },
        ];

  return (
    <div className="neo-card p-6 flex flex-col justify-between h-full">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-bold text-[#343C6A]">
          Recent Bot Activity
        </h4>
        <span className="text-xs text-[#1814F3] font-semibold">
          Live Log
        </span>
      </div>

      <div className="space-y-4">
        {displayItems.map((item, index) => {
          const isFirst = index === 0;
          const isSecond = index === 1;

          return (
            <div key={item.id} className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                    isFirst
                      ? "bg-[#FFF5D9] text-[#FFBB38]"
                      : isSecond
                      ? "bg-[#E7EDFF] text-[#1814F3]"
                      : "bg-[#DCFAF8] text-[#16DBCC]"
                  }`}
                >
                  {isFirst ? (
                    <Send className="w-5 h-5" />
                  ) : isSecond ? (
                    <RefreshCw className="w-5 h-5" />
                  ) : (
                    <MessageSquare className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-bold text-[#343C6A]">
                    {item.title || "Laporan Telegram"}
                  </p>
                  <p className="text-xs text-[#718EBF]">
                    {item.desc || "Log terkirim dari server produksi"}
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#16DBCC]">
                {item.status === "ACTIVE" ? "Aktif" : "Sukses"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
