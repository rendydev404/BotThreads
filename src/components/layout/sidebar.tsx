"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, CalendarClock, Bot, CreditCard, Radar, Settings, ShieldCheck, Sparkles, AtSign, TrendingUp, Route, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMe } from "./use-me";
import { useT } from "@/components/i18n/lang-provider";

/**
 * `mobile: false` = di layar kecil masuk menu "Lainnya" (bilah bawah hanya muat lima tombol).
 * Urutan bilah bawah ponsel mengikuti `mobileOrder`; `mobileName`/`mobileIcon` = label & ikon khusus ponsel.
 */
export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  mobile: boolean;
  mobileOrder?: number;
  mobileName?: string;
  mobileIcon?: LucideIcon;
  /** Judul kelompok di menu samping; urutannya mengikuti alur kerja (lihat lib/system-flow). */
  group?: string;
  /** Penjelasan singkat saat kursor diarahkan ke menu. */
  hint?: string;
}

export const navigationItems: NavItem[] = [
  { name: "Ringkasan", href: "/", icon: LayoutDashboard, mobile: true, mobileOrder: 1, hint: "Views, interaksi, dan akun terbaik" },
  { name: "Cara Kerja", href: "/cara-kerja", icon: Route, mobile: false, hint: "Peta alur BotThreads, langkah demi langkah" },
  { name: "Akun Threads", href: "/akun", icon: AtSign, mobile: false, group: "1 · Siapkan", hint: "Hubungkan akun dan isi Profil AI" },
  { name: "Radar", href: "/radar", icon: Radar, mobile: true, mobileOrder: 2, mobileName: "Trend", mobileIcon: TrendingUp, group: "2 · Berjalan otomatis", hint: "Bank ide dari tren, momen, dan posting terbaik" },
  { name: "Autopilot", href: "/autopilot", icon: Bot, mobile: true, mobileOrder: 3, group: "2 · Berjalan otomatis", hint: "AI menulis, memeriksa, dan mengantre posting" },
  { name: "Jadwal", href: "/jadwal", icon: CalendarClock, mobile: false, group: "2 · Berjalan otomatis", hint: "Antrean posting yang akan terbit" },
  { name: "Postingan", href: "/posts", icon: FileText, mobile: false, group: "3 · Lihat hasil", hint: "Semua posting beserta angkanya" },
  { name: "Studio AI", href: "/prompt-studio", icon: Sparkles, mobile: true, mobileOrder: 4, group: "3 · Lihat hasil", hint: "Tanya AI soal performa akun" },
  { name: "Billing & Paket", href: "/billing", icon: CreditCard, mobile: false, group: "Lainnya" },
  { name: "Pengaturan", href: "/pengaturan", icon: Settings, mobile: false, group: "Lainnya", hint: "Brand, pengetahuan AI, tagihan, kesehatan autopilot" },
];

/** Konsol admin platform (aplikasi terpisah di /admin): hanya tampil untuk staf platform. */
export const adminNavItem: NavItem = { name: "Konsol Admin", href: "/admin", icon: ShieldCheck, mobile: false, group: "Lainnya" };

export const isActivePath = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Sidebar() {
  const t = useT();
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

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map((item, i) => {
          const isActive = isActivePath(pathname, item.href);
          const Icon = item.icon;
          const groupStart = item.group && item.group !== items[i - 1]?.group;

          return (
            <React.Fragment key={item.name}>
              {groupStart && <p className="px-3 pt-4 pb-1 text-[11px] font-bold tracking-wider text-faint uppercase">{t(item.group as string)}</p>}
              <Link
                href={item.href}
                data-tour={`nav:${item.href}`}
                aria-current={isActive ? "page" : undefined}
                title={item.hint ? t(item.hint) : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent-soft text-accent font-semibold"
                    : "text-muted hover:text-fg hover:bg-subtle"
                )}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span>{t(item.name)}</span>
              </Link>
            </React.Fragment>
          );
        })}
      </nav>

      <div className="m-3 px-3 py-3 rounded-xl bg-subtle flex items-start gap-2.5">
        <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
          {!offline && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping" />}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", offline ? "bg-warning" : "bg-success")} />
        </span>
        <div className="text-xs leading-relaxed min-w-0">
          <p className="font-semibold text-fg truncate">{offline ? t("Profil belum termuat") : workspace ?? t("Terhubung")}</p>
          <p className="text-muted">
            {offline ? t("Periksa koneksi Anda") : count === null ? t("Memuat akun...") : t("{n} akun Threads", { n: count })}
          </p>
        </div>
      </div>
    </aside>
  );
}
