"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";

interface FormatPieChartProps {
  data: Array<{
    name: string;
    value: number;
    count: number;
    color: string;
  }>;
}

export function FormatPieChart({ data }: FormatPieChartProps) {
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
    <div className="w-full flex flex-col items-center justify-center">
      <div className="w-full h-52 sm:h-56 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const item = payload[0].payload;
                  return (
                    <div className="bg-white p-2.5 rounded-xl shadow-lg border border-[#EDF2F7] text-xs">
                      <p className="font-bold text-[#343C6A]">{item.name}</p>
                      <p className="text-[#718EBF]">
                        Proporsi: <span className="font-semibold text-[#1814F3]">{item.value}%</span> ({item.count} post)
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Pie
              data={data}
              innerRadius={58}
              outerRadius={84}
              paddingAngle={4}
              dataKey="value"
              stroke="#FFFFFF"
              strokeWidth={3}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center Text inside Donut */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xl font-bold text-[#343C6A]">100%</span>
          <span className="text-[11px] text-[#718EBF] font-medium">Format</span>
        </div>
      </div>

      {/* Custom Legend */}
      <div className="grid grid-cols-2 gap-2.5 w-full mt-2 pt-2 border-t border-[#EDF2F7]">
        {data.map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[#718EBF] truncate">{item.name}</span>
            <span className="font-bold text-[#343C6A] ml-auto">
              {item.value}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
