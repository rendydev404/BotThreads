"use client";

import React, { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  variant?: "icon" | "pill";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className = "" }: ThemeToggleProps) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-10 h-10 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] animate-pulse" />
    );
  }

  const isDark = resolvedTheme === "dark";

  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer select-none ${
          isDark
            ? "bg-[#1E293B] border-[#334155] text-amber-400 hover:border-amber-400/40"
            : "bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B] hover:border-[#CBD5E1]"
        } ${className}`}
        title={isDark ? "Beralih ke Mode Terang" : "Beralih ke Mode Gelap"}
        aria-label="Ganti tema tampilan"
      >
        {isDark ? (
          <>
            <Sun className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-slate-200">Mode Terang</span>
          </>
        ) : (
          <>
            <Moon className="w-4 h-4 text-[#64748B]" />
            <span className="text-xs font-semibold text-[#1E293B]">Mode Gelap</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
        isDark
          ? "bg-[#1E293B] border-[#334155] text-amber-400 hover:bg-[#334155] hover:text-amber-300"
          : "bg-[#F8FAFC] border-[#E2E8F0] text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1814F3]"
      } ${className}`}
      title={isDark ? "Beralih ke Mode Terang" : "Beralih ke Mode Gelap"}
      aria-label="Ganti tema tampilan"
    >
      {isDark ? (
        <Sun className="w-4 h-4 transition-transform duration-200 rotate-0 scale-100 text-amber-400" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-200 rotate-0 scale-100 text-[#64748B]" />
      )}
    </button>
  );
}
