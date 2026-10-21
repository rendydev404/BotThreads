"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Check, ChevronDown, Compass, KeyRound, Loader2, LogOut, Settings } from "lucide-react";
import { startTour } from "@/components/tour/tour-events";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ROLE_LABELS, switchWorkspace } from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { ChangePasswordModal } from "./change-password-modal";
import { NotificationBell } from "./notification-bell";
import { logout } from "./session-nav";
import { useMe } from "./use-me";
import { usePopover } from "./use-popover";

const TITLES: [prefix: string, title: string][] = [
  ["/posts", "Postingan Cabang"],
  ["/jadwal", "Jadwal Konten"],
  ["/autopilot", "Autopilot Konten"],
  ["/radar", "Radar dan Ide"],
  ["/prompt-studio", "Studio AI"],
  ["/billing", "Billing & Paket Sewa"],
  ["/pengaturan", "Pengaturan"],
  ["/admin", "Konsol Admin"],
];

const titleOf = (pathname: string): string =>
  pathname === "/"
    ? "Ringkasan Performa"
    : TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? "Dashboard";

/** Dua huruf awal untuk avatar: dari nama ("Rendy Dev" -> "RD") atau username. */
function initials(name: string | null | undefined, username: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const base = words[0] ?? username ?? "";
  return base.slice(0, 2).toUpperCase() || "··";
}

const MENU_ITEM_CLS =
  "w-full flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium text-fg hover:bg-subtle transition-colors cursor-pointer text-left";

function UserMenu() {
  const { me, loading } = useMe();
  const { open, setOpen, rootRef, triggerRef } = usePopover<HTMLDivElement>();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const displayName = me?.user.name || me?.user.username || (loading ? "Memuat..." : "Akun");
  const workspaces = me?.workspaces ?? [];

  const pickWorkspace = async (workspaceId: string) => {
    if (switching || workspaceId === me?.workspaceId) return;
    setSwitching(workspaceId);
    setSwitchError(null);
    try {
      await switchWorkspace(workspaceId);
      // Muat ulang penuh: semua data di layar milik workspace sebelumnya.
      window.location.reload();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Gagal pindah workspace.");
      setSwitching(null);
    }
  };

  return (
    <div ref={rootRef} className="relative ml-1 pl-2.5 border-l border-line">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu akun ${displayName}`}
        className="flex items-center gap-2 h-10 pl-1 pr-1.5 rounded-lg hover:bg-subtle transition-colors cursor-pointer"
      >
        <span
          className={cn(
            "w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center font-bold text-xs shrink-0",
            loading && "animate-pulse"
          )}
        >
          {initials(me?.user.name, me?.user.username)}
        </span>
        <span className="hidden lg:block leading-tight text-left min-w-0 max-w-[140px]">
          <span className="block text-sm font-semibold text-fg truncate">{displayName}</span>
          {me && <span className="block text-[11px] text-muted truncate">{ROLE_LABELS[me.role]}</span>}
        </span>
        <ChevronDown className={cn("hidden sm:block w-4 h-4 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu akun"
          className="fixed inset-x-4 top-[4.5rem] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-72 bg-surface rounded-xl p-1.5 shadow-pop border border-line z-50 animate-[pop-in_140ms_ease-out]"
        >
          <div className="px-3 py-2.5">
            <p className="text-sm font-semibold text-fg truncate">{displayName}</p>
            {me && (
              <p className="text-xs text-muted truncate">
                {me.user.email ?? `@${me.user.username}`} · {ROLE_LABELS[me.role]}
              </p>
            )}
          </div>

          {workspaces.length > 1 && (
            <div className="border-t border-line pt-1.5 mt-0.5">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Workspace</p>
              {workspaces.map((w) => {
                const active = w.workspaceId === me?.workspaceId;
                return (
                  <button
                    key={w.workspaceId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    disabled={!!switching}
                    onClick={() => pickWorkspace(w.workspaceId)}
                    className={cn(MENU_ITEM_CLS, "h-11 disabled:opacity-60 disabled:cursor-default")}
                  >
                    <Building2 className="w-[18px] h-[18px] text-muted shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{w.nama}</span>
                      <span className="block text-[11px] font-normal text-muted">{ROLE_LABELS[w.role]}</span>
                    </span>
                    {switching === w.workspaceId ? (
                      <Loader2 className="w-4 h-4 text-muted animate-spin shrink-0" />
                    ) : (
                      active && <Check className="w-4 h-4 text-accent shrink-0" />
                    )}
                  </button>
                );
              })}
              {switchError && (
                <p role="alert" className="px-3 py-1.5 text-xs font-medium text-danger">
                  {switchError}
                </p>
              )}
            </div>
          )}

          <div className="border-t border-line pt-1.5 mt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
              className={MENU_ITEM_CLS}
            >
              <KeyRound className="w-[18px] h-[18px] text-muted shrink-0" />
              Ganti password
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                startTour();
              }}
              className={MENU_ITEM_CLS}
            >
              <Compass className="w-[18px] h-[18px] text-muted shrink-0" />
              Tur pengenalan
            </button>
            <Link href="/pengaturan" role="menuitem" onClick={() => setOpen(false)} className={MENU_ITEM_CLS}>
              <Settings className="w-[18px] h-[18px] text-muted shrink-0" />
              Pengaturan
            </Link>
            <button type="button" role="menuitem" onClick={logout} className={cn(MENU_ITEM_CLS, "text-danger hover:bg-danger-soft")}>
              <LogOut className="w-[18px] h-[18px] shrink-0" />
              Keluar
            </button>
          </div>
        </div>
      )}

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const title = titleOf(pathname);
  // Di layar kecil cukup kata pertama agar tidak terpotong ("Ringkasan Perfo…")
  const shortTitle = title.split(" ")[0];

  return (
    <header className="h-16 bg-surface/90 backdrop-blur border-b border-line px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-2.5 min-w-0">
        <Image
          src="/logo.webp"
          alt="BotThreads"
          width={32}
          height={32}
          className="md:hidden w-8 h-8 rounded-lg shrink-0"
        />
        <h1 className="text-lg font-bold text-fg truncate">
          <span className="sm:hidden">{shortTitle}</span>
          <span className="hidden sm:inline">{title}</span>
        </h1>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
