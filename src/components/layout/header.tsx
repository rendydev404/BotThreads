"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { Search, Bell, X } from "lucide-react";

const titleMap: Record<string, string> = {
  "/": "Overview",
  "/posts": "Content & Posts Hub",
  "/prompt-studio": "Hermes AI Prompt Studio",
  "/auto-comment": "Auto Comment Bot",
};

export function Header() {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState("");
  const [hasNotifications, setHasNotifications] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);

  const title =
    titleMap[pathname] ||
    (pathname.startsWith("/posts") ? "Content & Posts Hub" : "Dashboard");

  return (
    <header className="h-20 bg-white border-b border-[#EDF2F7] px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
      {/* Page Title */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          {title}
        </h1>
      </div>

      {/* Right Controls: Custom Search + Notifications + Profile */}
      <div className="flex items-center gap-3 md:gap-5">
        {/* Custom Pill Search (No Native OS Control) */}
        <div className="relative hidden sm:flex items-center">
          <div className="absolute left-4 text-[#718EBF] pointer-events-none">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for something"
            className="w-48 lg:w-64 h-11 pl-11 pr-8 bg-[#F5F7FA] text-[#343C6A] placeholder-[#8BA3CB] text-sm rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 text-[#718EBF] hover:text-[#343C6A] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Circular Action: Notification Bell with Red Badge */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notifications"
            className="w-11 h-11 rounded-full bg-[#F5F7FA] text-[#718EBF] hover:text-[#1814F3] hover:bg-[#F0F3F8] flex items-center justify-center transition-colors relative cursor-pointer"
          >
            <Bell className="w-5 h-5" strokeWidth={2} />
            {hasNotifications && (
              <span className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full bg-[#FF4B4A] ring-2 ring-white" />
            )}
          </button>

          {/* Custom Notification Popover */}
          {showNotifications && (
            <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl p-4 shadow-xl border border-[#EDF2F7] z-50">
              <div className="flex items-center justify-between pb-3 border-b border-[#EDF2F7]">
                <h4 className="font-bold text-sm text-[#343C6A]">
                  Notifikasi Bot
                </h4>
                <button
                  onClick={() => {
                    setHasNotifications(false);
                    setShowNotifications(false);
                  }}
                  className="text-xs text-[#1814F3] font-medium hover:underline cursor-pointer"
                >
                  Tandai Dibaca
                </button>
              </div>
              <div className="py-2 space-y-2">
                <div className="p-2.5 rounded-xl bg-[#F4F7FE] flex gap-3 items-start">
                  <span className="w-2 h-2 rounded-full bg-[#16DBCC] mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-[#343C6A]">
                      Sync Metrik Sukses
                    </p>
                    <p className="text-[11px] text-[#718EBF]">
                      Akun Threads berhasil sinkronisasi 1,680 postingan.
                    </p>
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-[#F4F7FE] flex gap-3 items-start">
                  <span className="w-2 h-2 rounded-full bg-[#1814F3] mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-[#343C6A]">
                      Hermes Agent Siap
                    </p>
                    <p className="text-[11px] text-[#718EBF]">
                      AI Engine siap memproses prompt dan analisis performa.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Avatar */}
        <div className="flex items-center gap-3 pl-1">
          <div className="w-11 h-11 rounded-full bg-[#1814F3]/10 border-2 border-white shadow-sm flex items-center justify-center overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
              alt="Admin Profile"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
