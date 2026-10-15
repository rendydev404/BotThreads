"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, CalendarClock, Bot, CreditCard, Radar, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "./use-me";

/** `mobile: false` = di layar kecil masuk menu "Lainnya" (bilah bawah hanya muat lima tombol). */
export const navigationItems = [
  { name: "Ringkasan", href: "/", icon: LayoutDashboard, mobile: true },
  { name: "Postingan", href: "/posts", icon: FileText, mobile: false },
  { name: "Jadwal", href: "/jadwal", icon: CalendarClock, mobile: true },
  { name: "Autopilot", href: "/autopilot", icon: Bot, mobile: true },
  { name: "Radar", href: "/radar", icon: Radar, mobile: false },
  { name: "Studio AI", href: "/prompt-studio", icon: Sparkles, mobile: true },
  { name: "Billing & Paket", href: "/billing", icon: CreditCard, mobile: false },
  { name: "Pengaturan", href: "/pengaturan", icon: Settings, mobile: false },
];

/** Panel pengelola platform: hanya tampil untuk super admin. */
export const adminNavItem = { name: "Super Admin", href: "/admin", icon: ShieldCheck, mobile: false };

export const isActivePath = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Sidebar() {
  const pathname = usePathname();
  const { me, error } = useMe();

  const workspace = me?.workspaces.find((w) => w.workspaceId === me.workspaceId)?.nama ?? null;
  const count = me?.accountCount ?? null;
  const offline = !me && !!error;
  const items = me?.superadmin ? [...navigationItems, adminNavItem] : navigationItems;

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
            BotThreads
          </span>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {items.map((item) => {
          const isActive = isActivePath(pathname, item.href);
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
          {!offline && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", offline ? "bg-warning" : "bg-success")} />
        </span>
        <div className="text-xs leading-relaxed min-w-0">
          <p className="font-semibold text-fg truncate">{offline ? "Profil belum termuat" : workspace ?? "Terhubung"}</p>
          <p className="text-muted">
            {offline ? "Periksa koneksi Anda" : count === null ? "Memuat akun..." : `${count} akun Threads`}
          </p>
        </div>
      </div>
    </aside>
  );
}
