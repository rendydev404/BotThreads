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
import { useTheme } from "@/components/theme/theme-provider";

interface WeeklyActivityProps {
  data: Array<{
    day: string;
    views: number;
    interactions: number;
  }>;
}

export function WeeklyActivityChart({ data }: WeeklyActivityProps) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-64 w-full flex items-center justify-center bg-[#F4F7FE]/50 dark:bg-[#1E293B]/30 rounded-2xl animate-pulse">
        <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";

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
            stroke={isDark ? "#1F2937" : "#EDF2F7"}
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: isDark ? "#94A3B8" : "#718EBF", fontSize: 12, fontWeight: 500 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: isDark ? "#94A3B8" : "#718EBF", fontSize: 12 }}
            tickFormatter={(val) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)}
          />
          <Tooltip
            cursor={{ fill: isDark ? "#1E293B" : "#F4F7FE" }}
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-white dark:bg-[#111827] p-3 rounded-2xl shadow-xl border border-[#EDF2F7] dark:border-[#1F2937] text-xs">
                    <p className="font-bold text-[#343C6A] dark:text-[#F8FAFC] mb-1.5">{label}</p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#1814F3] dark:bg-blue-500" />
                        <span className="text-[#718EBF] dark:text-[#94A3B8]">Views:</span>
                        <span className="font-bold text-[#343C6A] dark:text-[#F8FAFC]">
                          {formatNumber(Number(payload[0]?.value) || 0)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
                        <span className="text-[#64748B] dark:text-[#94A3B8]">Interaksi:</span>
                        <span className="font-bold text-[#1E293B] dark:text-[#F8FAFC]">
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
          <Bar
            dataKey="views"
            name="Views"
            fill={isDark ? "#3B82F6" : "#1814F3"}
            radius={[6, 6, 0, 0]}
            barSize={14}
          />
          <Bar
            dataKey="interactions"
            name="Interaksi"
            fill="#10B981"
            radius={[6, 6, 0, 0]}
            barSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
