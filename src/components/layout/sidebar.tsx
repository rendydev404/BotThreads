"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Bot,
  MessageCircle,
  BarChart3,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigationItems = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "Content & Posts",
    href: "/posts",
    icon: FileText,
  },
  {
    name: "Prompt Studio",
    href: "/prompt-studio",
    icon: Bot,
  },
  {
    name: "Auto Comment",
    href: "/auto-comment",
    icon: MessageCircle,
  },
  {
    name: "Analytics",
    href: "/analytics",
    icon: BarChart3,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-64 bg-white border-r border-[#EDF2F7] min-h-screen sticky top-0 shrink-0 z-30">
      {/* Brand Header */}
      <div className="h-20 flex items-center px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-[#1814F3] flex items-center justify-center text-white shadow-sm">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-[#343C6A]">
            BotDash<span className="text-[#1814F3]">.</span>
          </span>
        </Link>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 py-4 space-y-1">
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
                "relative flex items-center gap-4 px-8 py-3.5 text-[15px] font-medium transition-colors",
                isActive
                  ? "text-[#1814F3] font-semibold"
                  : "text-[#718EBF] hover:text-[#343C6A] hover:bg-[#F4F7FE]/60"
              )}
            >
              {/* Active Left Indicator Bar (Neo-Fintech BankFlash signature) */}
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1814F3] rounded-r-md" />
              )}
              <Icon
                className={cn(
                  "w-5 h-5 shrink-0 transition-colors",
                  isActive ? "text-[#1814F3]" : "text-[#718EBF]"
                )}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
