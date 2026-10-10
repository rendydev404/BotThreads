"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  {
    name: "Ringkasan",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "Postingan",
    href: "/posts",
    icon: FileText,
  },
  {
    name: "Studio AI",
    href: "/prompt-studio",
    icon: Bot,
    highlight: true,
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-md border-t border-[#EDF2F7] dark:border-[#1F2937] px-3 py-2 pb-safe shadow-[0_-4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)] transition-colors">
      <div className="flex items-center justify-around max-w-md mx-auto">
        {mobileNavItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          if (item.highlight) {
            return (
              <Link
                key={item.name}
                href={item.href}
                className="relative -top-4 flex flex-col items-center group"
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform group-active:scale-95",
                    isActive
                      ? "bg-[#1814F3] text-white shadow-[#1814F3]/30"
                      : "bg-[#1814F3] text-white"
                  )}
                >
                  <Icon className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <span
                  className={cn(
                    "text-[10px] font-semibold mt-1 transition-colors",
                    isActive ? "text-[#1814F3] dark:text-blue-400" : "text-[#718EBF] dark:text-[#94A3B8]"
                  )}
                >
                  {item.name}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center py-1 px-2.5 rounded-xl transition-all",
                isActive
                  ? "text-[#1814F3] dark:text-blue-400"
                  : "text-[#718EBF] dark:text-[#94A3B8] active:text-[#343C6A] dark:active:text-white"
              )}
            >
              <div className="relative">
                <Icon
                  className="w-5 h-5 transition-transform"
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {isActive && (
                  <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-[#1814F3] dark:bg-blue-400" />
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] mt-1 font-medium tracking-tight",
                  isActive ? "font-bold text-[#1814F3] dark:text-blue-400" : "text-[#718EBF] dark:text-[#94A3B8]"
                )}
              >
                {item.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
