"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Bot, Flame, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const navigationItems = [
  {
    name: "Ringkasan Performa",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "Postingan Cabang",
    href: "/posts",
    icon: FileText,
  },
  {
    name: "Studio AI & Analisis",
    href: "/prompt-studio",
    icon: Bot,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-[#111827] border-r border-[#E2E8F0] dark:border-[#1F2937] min-h-screen sticky top-0 shrink-0 z-30 transition-colors">
      {/* Brand Header */}
      <div className="h-20 flex items-center px-6 border-b border-[#F1F5F9] dark:border-[#1F2937]">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1814F3] flex items-center justify-center text-white shadow-xs">
            <Flame className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-base font-extrabold tracking-tight text-[#1E293B] dark:text-[#F8FAFC] block leading-tight">
              Suka Shawarma
            </span>
            <span className="text-[10px] font-semibold text-[#64748B] dark:text-[#94A3B8] uppercase tracking-wider">
              Threads Fleet Bot
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 py-5 px-3 space-y-1">
        {navigationItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition-all",
                isActive
                  ? "bg-[#1814F3] text-white shadow-xs"
                  : "text-[#64748B] dark:text-[#94A3B8] hover:text-[#1E293B] dark:hover:text-white hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0 transition-colors",
                  isActive
                    ? "text-white"
                    : "text-[#64748B] dark:text-[#94A3B8]"
                )}
              />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sidebar Footer Info */}
      <div className="p-4 m-3 rounded-2xl bg-[#F8FAFC] dark:bg-[#1E293B]/60 border border-[#E2E8F0] dark:border-[#1F2937] text-xs">
        <div className="flex items-center gap-2 text-[#1E293B] dark:text-[#F8FAFC] font-bold mb-1">
          <Database className="w-3.5 h-3.5 text-[#1814F3] dark:text-blue-400" />
          <span>Status Jaringan</span>
        </div>
        <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] leading-relaxed">
          32 akun Threads aktif terhubung ke database Supabase.
        </p>
      </div>
    </aside>
  );
}
