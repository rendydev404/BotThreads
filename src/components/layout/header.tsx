"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Radio, CheckCircle2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const titleMap: Record<string, string> = {
  "/": "Ringkasan Performa Threads",
  "/posts": "Semua Postingan Cabang",
  "/prompt-studio": "Studio AI & Analisis",
};

export function Header() {
  const pathname = usePathname();
  const [hasNotifications, setHasNotifications] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);

  const title =
    titleMap[pathname] ||
    (pathname.startsWith("/posts") ? "Semua Postingan Cabang" : "Dashboard");

  return (
    <header className="h-20 bg-white dark:bg-[#111827] border-b border-[#E2E8F0] dark:border-[#1F2937] px-4 md:px-8 flex items-center justify-between sticky top-0 z-20 transition-colors">
      {/* Page Title & Live Fleet Badge */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg md:text-xl font-extrabold text-[#1E293B] dark:text-[#F8FAFC] tracking-tight">
          {title}
        </h1>
        <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>32 Cabang Aktif</span>
        </div>
      </div>

      {/* Right Controls: Database Sync Status + Theme Toggle + Notifications + Profile */}
      <div className="flex items-center gap-2.5 md:gap-3">
        {/* System Sync Pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] text-xs text-[#64748B] dark:text-[#94A3B8]">
          <Radio className="w-3.5 h-3.5 text-[#1814F3] dark:text-blue-400" />
          <span className="font-medium">Supabase Real-time</span>
        </div>

        {/* Theme Toggle Button */}
        <ThemeToggle />

        {/* Action: Notification Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifikasi"
            className="w-10 h-10 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] dark:text-[#94A3B8] hover:text-[#1814F3] dark:hover:text-blue-400 hover:bg-[#F1F5F9] dark:hover:bg-[#334155] flex items-center justify-center transition-colors relative cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {hasNotifications && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#FF4B4A] ring-2 ring-white dark:ring-[#111827]" />
            )}
          </button>

          {/* Custom Notification Popover */}
          {showNotifications && (
            <div className="absolute right-0 mt-3 w-80 bg-white dark:bg-[#111827] rounded-2xl p-4 shadow-xl border border-[#E2E8F0] dark:border-[#1F2937] z-50">
              <div className="flex items-center justify-between pb-3 border-b border-[#EDF2F7] dark:border-[#1F2937]">
                <h4 className="font-bold text-xs text-[#1E293B] dark:text-[#F8FAFC]">
                  Notifikasi Sistem
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setHasNotifications(false);
                    setShowNotifications(false);
                  }}
                  className="text-[11px] text-[#1814F3] dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                >
                  Tandai Dibaca
                </button>
              </div>
              <div className="py-2 space-y-2">
                <div className="p-2.5 rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#F1F5F9] dark:border-[#334155] flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#1E293B] dark:text-[#F8FAFC]">
                      Database Tersinkronisasi
                    </p>
                    <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] mt-0.5">
                      32 akun Threads dan 1.680 postingan sukses tersambung.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Info / Profile */}
        <div className="flex items-center gap-2.5 pl-2 border-l border-[#E2E8F0] dark:border-[#1F2937]">
          <div className="w-9 h-9 rounded-xl bg-[#1814F3] text-white flex items-center justify-center font-bold text-xs shadow-xs">
            SS
          </div>
          <div className="hidden xl:block">
            <p className="text-xs font-bold text-[#1E293B] dark:text-[#F8FAFC] leading-tight">
              Suka Shawarma
            </p>
            <p className="text-[10px] text-[#64748B] dark:text-[#94A3B8]">Admin Dashboard</p>
          </div>
        </div>
      </div>
    </header>
  );
}
