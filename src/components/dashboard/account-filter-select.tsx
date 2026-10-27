"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Search, Users, X } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { useT } from "@/components/i18n/lang-provider";

export interface AccountItem {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  followers?: number | null;
  _count?: {
    postStats: number;
    dailyStats?: number;
  };
}

interface AccountFilterSelectProps {
  accounts: AccountItem[];
  selectedAccount: string; // 'all' atau username
  onSelectAccount: (username: string) => void;
  totalAccounts?: number;
  className?: string;
}

const isMobile = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;

function Avatar({ acc, size = "w-9 h-9" }: { acc: AccountItem; size?: string }) {
  return <AccountAvatar name={acc.displayName} src={acc.avatarUrl} size={size} className="text-xs" />;
}

export function AccountFilterSelect({
  accounts,
  selectedAccount,
  onSelectAccount,
  totalAccounts = 32,
  className,
}: AccountFilterSelectProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const isAll = selectedAccount === "all" || !selectedAccount;
  const current = isAll
    ? null
    : accounts.find((a) => a.username?.toLowerCase() === selectedAccount.toLowerCase());

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.username?.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  // Esc menutup; di mobile halaman di belakang sheet dikunci agar tidak ikut scroll
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);

    const lock = isMobile();
    const prev = document.body.style.overflow;
    if (lock) document.body.style.overflow = "hidden";
    // Fokus otomatis hanya di desktop; di mobile keyboard akan menutupi daftar
    if (!lock) searchRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const pick = (username: string) => {
    onSelectAccount(username);
    close();
  };

  return (
    <div className={cn("relative w-full sm:w-auto", className)}>
      {/* Tombol pemicu: sengaja mencolok agar jelas ini filter per akun */}
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "w-full sm:min-w-[270px] h-14 pl-2.5 pr-3 flex items-center gap-3 rounded-xl border-2 text-left transition-all cursor-pointer",
          isAll
            ? "bg-surface border-accent/40 hover:border-accent"
            : "bg-accent-soft border-accent",
          open && "border-accent ring-4 ring-accent/15"
        )}
      >
        <span className="w-9 h-9 rounded-lg bg-accent text-on-accent flex items-center justify-center shrink-0">
          {isAll ? <Users className="w-[18px] h-[18px]" /> : <Globe className="w-[18px] h-[18px]" />}
        </span>

        <span className="flex-1 min-w-0 leading-tight">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-accent">
            {isAll ? t("Filter per akun") : t("Akun terpilih")}
          </span>
          <span className="block text-sm font-semibold text-fg truncate">
            {isAll
              ? t("Semua akun ({n})", { n: totalAccounts })
              : current?.displayName || `@${selectedAccount}`}
          </span>
        </span>

        <span
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors",
            open ? "bg-accent text-on-accent" : "bg-accent-soft text-accent"
          )}
        >
          <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <>
          {/* Latar: gelap di mobile, transparan di desktop (penangkap klik di luar) */}
          <div
            className="fixed inset-0 z-50 bg-black/45 sm:bg-transparent animate-[fade-in_150ms_ease-out]"
            onClick={close}
            aria-hidden
          />

          <div
            role="dialog"
            aria-label={t("Pilih akun cabang")}
            className={cn(
              "z-50 bg-surface border border-line flex flex-col shadow-pop overflow-hidden",
              // Mobile: bottom sheet penuh lebar
              "fixed inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl animate-[sheet-up_220ms_ease-out]",
              // Desktop: popover di bawah tombol
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:left-0 lg:left-auto lg:right-0",
              "sm:w-[26rem] sm:max-h-[28rem] sm:rounded-2xl sm:animate-[pop-in_150ms_ease-out]"
            )}
          >
            {/* Pegangan + judul (mobile) */}
            <div className="sm:hidden pt-2.5 flex justify-center">
              <span className="w-10 h-1.5 rounded-full bg-line-strong" />
            </div>
            <div className="flex items-center justify-between px-4 pt-3 pb-2 sm:pt-4">
              <div>
                <h3 className="text-base font-bold text-fg">{t("Pilih akun cabang")}</h3>
                <p className="text-xs text-muted">
                  {t("Lihat data satu akun saja, atau gabungan semuanya")}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label={t("Tutup")}
                className="w-9 h-9 rounded-full text-muted hover:text-fg hover:bg-subtle flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-4 pb-3">
              <div className="relative">
                <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("Cari nama cabang atau @username")}
                  aria-label={t("Cari akun")}
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-subtle border border-transparent text-sm text-fg placeholder-faint outline-none focus:bg-surface focus:border-accent transition-colors"
                />
              </div>
            </div>

            <ul
              role="listbox"
              aria-label={t("Daftar akun")}
              className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-line pt-2"
            >
              {!query.trim() && (
                <li role="option" aria-selected={isAll}>
                  <button
                    type="button"
                    onClick={() => pick("all")}
                    className={cn(
                      "w-full min-h-14 px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer",
                      isAll ? "bg-accent-soft" : "hover:bg-subtle"
                    )}
                  >
                    <span className="w-9 h-9 rounded-full bg-accent text-on-accent flex items-center justify-center shrink-0">
                      <Users className="w-[18px] h-[18px]" />
                    </span>
                    <span className="flex-1 min-w-0 leading-tight">
                      <span className="block text-sm font-semibold text-fg">
                        {t("Semua akun ({n})", { n: totalAccounts })}
                      </span>
                      <span className="block text-xs text-muted">
                        {t("Gabungan performa seluruh jaringan")}
                      </span>
                    </span>
                    {isAll && <Check className="w-5 h-5 text-accent shrink-0" />}
                  </button>
                </li>
              )}

              {filtered.map((acc) => {
                const selected =
                  !isAll && acc.username?.toLowerCase() === selectedAccount.toLowerCase();
                return (
                  <li key={acc.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      disabled={!acc.username}
                      onClick={() => acc.username && pick(acc.username)}
                      className={cn(
                        "w-full min-h-14 px-3 py-2 rounded-xl flex items-center gap-3 text-left transition-colors cursor-pointer disabled:opacity-50",
                        selected ? "bg-accent-soft" : "hover:bg-subtle"
                      )}
                    >
                      <Avatar acc={acc} />
                      <span className="flex-1 min-w-0 leading-tight">
                        <span className="block text-sm font-semibold text-fg truncate">
                          {acc.displayName}
                        </span>
                        <span className="block text-xs text-muted truncate">
                          @{acc.username}
                        </span>
                      </span>
                      <span hidden={!acc._count && (acc.followers === null || acc.followers === undefined)} className="text-xs font-medium text-muted bg-subtle rounded-full px-2 py-0.5 shrink-0">
                        {acc.followers !== null && acc.followers !== undefined
                          ? `${formatNumber(acc.followers)} fol · `
                          : ""}
                        {acc._count ? t("{n} post", { n: acc._count.postStats }) : ""}
                      </span>
                      {selected && <Check className="w-5 h-5 text-accent shrink-0" />}
                    </button>
                  </li>
                );
              })}

              {filtered.length === 0 && (
                <li className="py-10 text-center text-sm text-muted">
                  {t("Tidak ada akun yang cocok dengan “{query}”.", { query })}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
