"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Radio, CheckCircle2, User } from "lucide-react";

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
    <header className="h-20 bg-white border-b border-[#E2E8F0] px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
      {/* Page Title & Live Fleet Badge */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg md:text-xl font-extrabold text-[#1E293B] tracking-tight">
          {title}
        </h1>
        <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>32 Cabang Aktif</span>
        </div>
      </div>

      {/* Right Controls: Database Sync Status + Notifications + Profile */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* System Sync Pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B]">
          <Radio className="w-3.5 h-3.5 text-[#1814F3]" />
          <span className="font-medium">Supabase Real-time</span>
        </div>

        {/* Action: Notification Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifikasi"
            className="w-10 h-10 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] hover:text-[#1814F3] hover:bg-[#F1F5F9] flex items-center justify-center transition-colors relative cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {hasNotifications && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#FF4B4A] ring-2 ring-white" />
            )}
          </button>

          {/* Custom Notification Popover */}
          {showNotifications && (
            <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl p-4 shadow-xl border border-[#E2E8F0] z-50">
              <div className="flex items-center justify-between pb-3 border-b border-[#EDF2F7]">
                <h4 className="font-bold text-xs text-[#1E293B]">
                  Notifikasi Sistem
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setHasNotifications(false);
                    setShowNotifications(false);
                  }}
                  className="text-[11px] text-[#1814F3] font-semibold hover:underline cursor-pointer"
                >
                  Tandai Dibaca
                </button>
              </div>
              <div className="py-2 space-y-2">
                <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#F1F5F9] flex gap-2.5 items-start">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#1E293B]">
                      Database Tersinkronisasi
                    </p>
                    <p className="text-[11px] text-[#64748B] mt-0.5">
                      32 akun Threads dan 1.680 postingan sukses tersambung.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Info / Profile */}
        <div className="flex items-center gap-2.5 pl-1 border-l border-[#E2E8F0]">
          <div className="w-9 h-9 rounded-xl bg-[#1814F3] text-white flex items-center justify-center font-bold text-xs shadow-xs">
            SS
          </div>
          <div className="hidden xl:block">
            <p className="text-xs font-bold text-[#1E293B] leading-tight">
              Suka Shawarma
            </p>
            <p className="text-[10px] text-[#64748B]">Admin Dashboard</p>
          </div>
        </div>
      </div>
    </header>
  );
}
