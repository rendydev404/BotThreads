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
    return <div className="h-64 w-full rounded-xl bg-subtle animate-pulse" />;
  }

  const isDark = resolvedTheme === "dark";
  const axis = isDark ? "#a0a6bd" : "#5b6179";
  const grid = isDark ? "#252a3a" : "#e8eaf1";
  const viewsColor = isDark ? "#7b8aff" : "#3a4cf0";
  const interactionColor = isDark ? "#3dd6a0" : "#0f9d6c";

  return (
    <div className="w-full h-64 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
          barGap={4}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={grid} />
          <XAxis
            dataKey="day"
            interval="preserveStartEnd"
            minTickGap={16}
            axisLine={false}
            tickLine={false}
            tick={{ fill: axis, fontSize: 13 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={44}
            tick={{ fill: axis, fontSize: 13 }}
            tickFormatter={(v) => formatNumber(Number(v))}
          />
          <Tooltip
            cursor={{ fill: isDark ? "#1b1f2d" : "#f3f4f8" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-surface p-3 rounded-xl shadow-pop border border-line text-sm">
                  <p className="font-semibold text-fg mb-1.5">{label}</p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                      <span className="text-muted">Penayangan</span>
                      <span className="ml-auto font-semibold text-fg">
                        {formatNumber(Number(payload[0]?.value) || 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-success" />
                      <span className="text-muted">Interaksi</span>
                      <span className="ml-auto font-semibold text-fg">
                        {formatNumber(Number(payload[1]?.value) || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="views"
            name="Penayangan"
            fill={viewsColor}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
          <Bar
            dataKey="interactions"
            name="Interaksi"
            fill={interactionColor}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
