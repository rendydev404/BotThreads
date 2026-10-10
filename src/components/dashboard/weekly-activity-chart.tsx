"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { formatNumber } from "@/lib/utils";

interface WeeklyActivityProps {
  data: Array<{
    day: string;
    views: number;
    interactions: number;
  }>;
}

export function WeeklyActivityChart({ data }: WeeklyActivityProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-64 w-full flex items-center justify-center bg-[#F4F7FE]/50 rounded-2xl animate-pulse">
        <div className="h-4 w-32 bg-slate-200 rounded" />
      </div>
    );
  }

  return (
    <div className="w-full h-64 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          barGap={10}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#EDF2F7"
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#718EBF", fontSize: 12, fontWeight: 500 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#718EBF", fontSize: 12 }}
            tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)}
          />
          <Tooltip
            cursor={{ fill: "#F4F7FE" }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-white p-3 rounded-2xl shadow-xl border border-[#EDF2F7] text-xs">
                    <p className="font-bold text-[#343C6A] mb-1.5">{label}</p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#1814F3]" />
                        <span className="text-[#718EBF]">Views:</span>
                        <span className="font-bold text-[#343C6A]">
                          {formatNumber(Number(payload[0]?.value) || 0)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#16DBCC]" />
                        <span className="text-[#718EBF]">Interaksi:</span>
                        <span className="font-bold text-[#343C6A]">
                          {formatNumber(Number(payload[1]?.value) || 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          {/* Dual Bar Pills matching BankFlash Style */}
          <Bar
            dataKey="views"
            name="Views"
            fill="#1814F3"
            radius={[20, 20, 20, 20]}
            barSize={12}
          />
          <Bar
            dataKey="interactions"
            name="Interaksi"
            fill="#16DBCC"
            radius={[20, 20, 20, 20]}
            barSize={12}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
