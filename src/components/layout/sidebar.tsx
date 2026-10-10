"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const navigationItems = [
  { name: "Ringkasan", href: "/", icon: LayoutDashboard },
  { name: "Postingan", href: "/posts", icon: FileText },
  { name: "Studio AI", href: "/prompt-studio", icon: Sparkles },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex flex-col w-60 bg-surface border-r border-line h-screen sticky top-0 shrink-0 z-30">
      <div className="h-16 flex items-center px-5">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo.webp"
            alt=""
            width={40}
            height={40}
            priority
            className="w-10 h-10 rounded-xl shrink-0"
          />
          <span className="text-[15px] font-bold text-fg leading-tight">
            Dashboard Analytics Threads
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
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
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent-soft text-accent font-semibold"
                  : "text-muted hover:text-fg hover:bg-subtle"
              )}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="m-3 px-3 py-3 rounded-xl bg-subtle flex items-start gap-2.5">
        <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <div className="text-xs leading-relaxed">
          <p className="font-semibold text-fg">Terhubung</p>
          <p className="text-muted">32 akun cabang aktif</p>
        </div>
      </div>
    </aside>
  );
}
