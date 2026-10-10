"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface EngagementHistoryProps {
  data: Array<{
    month: string;
    value: number;
  }>;
}

export function EngagementSplineChart({ data }: EngagementHistoryProps) {
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
        <AreaChart
          data={data}
          margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="engagementGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1814F3" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#1814F3" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="#EDF2F7"
          />
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#718EBF", fontSize: 12, fontWeight: 500 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#718EBF", fontSize: 12 }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-white p-3 rounded-2xl shadow-xl border border-[#EDF2F7] text-xs">
                    <p className="font-bold text-[#343C6A] mb-1">{label}</p>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#1814F3]" />
                      <span className="text-[#718EBF]">Interaksi:</span>
                      <span className="font-bold text-[#1814F3]">
                        {payload[0]?.value}K
                      </span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#1814F3"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#engagementGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
