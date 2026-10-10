"use client";

import React, { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Sector,
} from "recharts";
import { formatNumber } from "@/lib/utils";

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

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

  const totalCount = data.reduce((acc, curr) => acc + (curr.count || 0), 0);
  const activeItem = activeIndex !== null ? data[activeIndex] : null;

  return (
    <div className="w-full flex flex-col justify-between h-full space-y-4">
      {/* Interactive Donut with Clean Center Display (No Overlapping Tooltip) */}
      <div className="relative w-full h-48 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              innerRadius={55}
              outerRadius={75}
              paddingAngle={3}
              dataKey="value"
              stroke="#FFFFFF"
              strokeWidth={2}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              cursor="pointer"
              animationDuration={600}
            >
              {data.map((entry, index) => {
                const isHovered = activeIndex === index;
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color}
                    opacity={activeIndex === null || isHovered ? 1 : 0.45}
                    style={{
                      transition: "all 0.2s ease-in-out",
                      transform: isHovered ? "scale(1.04)" : "scale(1)",
                      transformOrigin: "center center",
                    }}
                  />
                );
              })}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Clean Center Dynamic Content (Always centered, never overlapping) */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-2">
          {activeItem ? (
            <div className="animate-in fade-in zoom-in-95 duration-150">
              <span
                className="text-2xl font-black block leading-none tracking-tight"
                style={{ color: activeItem.color }}
              >
                {activeItem.value}%
              </span>
              <span className="text-[11px] font-bold text-[#343C6A] block mt-1 truncate max-w-[110px]">
                {activeItem.name}
              </span>
              <span className="text-[10px] text-[#718EBF] font-medium block">
                {formatNumber(activeItem.count)} post
              </span>
            </div>
          ) : (
            <div>
              <span className="text-2xl font-black text-[#343C6A] block leading-none tracking-tight">
                {formatNumber(totalCount)}
              </span>
              <span className="text-[11px] text-[#718EBF] font-semibold block mt-1">
                Total Post
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Proportional Segmented Progress Bar */}
      <div className="w-full">
        <div className="h-2 w-full rounded-full bg-[#EDF2F7] flex overflow-hidden gap-0.5">
          {data.map((item, idx) => (
            <div
              key={item.name}
              style={{
                width: `${Math.max(item.value, 1.5)}%`,
                backgroundColor: item.color,
              }}
              className={`h-full transition-opacity cursor-pointer ${
                activeIndex === null || activeIndex === idx ? "opacity-100" : "opacity-35"
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(null)}
            />
          ))}
        </div>
      </div>

      {/* Interactive Legend List */}
      <div className="space-y-1.5 w-full pt-1 border-t border-[#EDF2F7]">
        {data.map((item, idx) => {
          const isSelected = activeIndex === idx;

          return (
            <div
              key={item.name}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(null)}
              className={`flex items-center justify-between text-xs py-1.5 px-2 rounded-xl transition-all cursor-pointer ${
                isSelected
                  ? "bg-[#F4F7FE] text-[#1814F3]"
                  : "hover:bg-[#F9FBFE] text-[#718EBF]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform"
                  style={{
                    backgroundColor: item.color,
                    transform: isSelected ? "scale(1.2)" : "scale(1)",
                  }}
                />
                <span
                  className={`truncate font-medium ${
                    isSelected ? "text-[#343C6A] font-bold" : "text-[#718EBF]"
                  }`}
                >
                  {item.name}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-[11px] text-[#718EBF]">
                  {formatNumber(item.count)}
                </span>
                <span
                  className={`font-bold text-xs ${
                    isSelected ? "text-[#1814F3]" : "text-[#343C6A]"
                  }`}
                >
                  {item.value}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
