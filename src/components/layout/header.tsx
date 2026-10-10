"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bell, CheckCircle2, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";

const titleMap: Record<string, string> = {
  "/": "Ringkasan Performa",
  "/posts": "Postingan Cabang",
  "/prompt-studio": "Studio AI",
};

export function Header() {
  const pathname = usePathname();
  const [hasNotifications, setHasNotifications] = useState(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showNotifications) return;
    const close = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showNotifications]);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  };

  const title =
    titleMap[pathname] ??
    (pathname.startsWith("/posts") ? titleMap["/posts"] : "Dashboard");

  return (
    <header className="h-16 bg-surface/90 backdrop-blur border-b border-line px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-2.5 min-w-0">
        <Image
          src="/logo.webp"
          alt="Dashboard Analytics Threads"
          width={32}
          height={32}
          className="md:hidden w-8 h-8 rounded-lg shrink-0"
        />
        <h1 className="text-lg font-bold text-fg truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />

        <div className="relative" ref={popRef}>
          <button
            type="button"
            onClick={() => setShowNotifications((v) => !v)}
            aria-label="Notifikasi"
            className="relative w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-subtle flex items-center justify-center transition-colors cursor-pointer"
          >
            <Bell className="w-[18px] h-[18px]" />
            {hasNotifications && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger ring-2 ring-surface" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-surface rounded-xl p-4 shadow-pop border border-line z-50">
              <div className="flex items-center justify-between pb-3 border-b border-line">
                <h4 className="font-semibold text-sm text-fg">Notifikasi</h4>
                <button
                  type="button"
                  onClick={() => {
                    setHasNotifications(false);
                    setShowNotifications(false);
                  }}
                  className="text-xs text-accent font-semibold hover:underline cursor-pointer"
                >
                  Tandai dibaca
                </button>
              </div>
              <div className="pt-3 flex gap-3 items-start">
                <CheckCircle2 className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-fg">
                    Data tersinkronisasi
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    32 akun Threads dan seluruh postingannya sudah tersambung.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 ml-2 pl-3 border-l border-line">
          <div className="w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center font-bold text-xs">
            SS
          </div>
          <div className="hidden lg:block leading-tight">
            <p className="text-sm font-semibold text-fg">Admin</p>
          </div>
          <button
            type="button"
            onClick={logout}
            title="Keluar"
            aria-label="Keluar"
            className="w-9 h-9 rounded-lg text-muted hover:text-danger hover:bg-danger-soft flex items-center justify-center transition-colors cursor-pointer"
          >
            <LogOut className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
