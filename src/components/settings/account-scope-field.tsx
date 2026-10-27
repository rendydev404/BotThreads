"use client";

import React, { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublishAccountDTO } from "@/lib/content-types";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { Segmented, accountHandle, type SegmentedOption } from "@/components/autopilot/shared";
import { ControlLabel, INPUT_CLS } from "./fields";
import { useT } from "@/components/i18n/lang-provider";

type ScopeMode = "SEMUA" | "PILIHAN";

const MODE_OPTIONS: SegmentedOption<ScopeMode>[] = [
  { value: "SEMUA", label: "Semua akun" },
  { value: "PILIHAN", label: "Akun tertentu" },
];

/** Kolom cari baru muncul bila daftarnya cukup panjang. */
const SEARCH_FROM = 8;

interface AccountScopeFieldProps {
  accounts: PublishAccountDTO[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** null = semua akun; array = hanya akun ini (kosong berarti belum memilih). */
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
  /** Galat validasi (mis. belum memilih akun). */
  invalid?: string | null;
}

/** Lingkup akun seorang anggota atau undangan: semua akun, atau subset yang dicentang. */
export function AccountScopeField({ accounts, loading, error, onRetry, value, onChange, disabled, invalid }: AccountScopeFieldProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  // Pilihan terakhir disimpan supaya bolak-balik "Semua akun" tidak menghapus centang.
  const [kept, setKept] = useState<string[]>(value ?? []);

  const picked = useMemo(() => new Set(value ?? []), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.username?.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q) || a.outletNama?.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  const setPicked = (ids: string[]) => {
    setKept(ids);
    onChange(ids);
  };
  const toggle = (id: string) => setPicked(picked.has(id) ? [...picked].filter((v) => v !== id) : [...picked, id]);
  const allFilteredOn = filtered.length > 0 && filtered.every((a) => picked.has(a.id));
  const toggleFiltered = () => {
    const ids = new Set(filtered.map((a) => a.id));
    setPicked(allFilteredOn ? [...picked].filter((id) => !ids.has(id)) : [...new Set([...picked, ...ids])]);
  };

  return (
    <div>
      <ControlLabel hint={t("Anggota hanya melihat dan mengelola akun dalam lingkupnya.")}>{t("Akses akun")}</ControlLabel>
      <Segmented
        ariaLabel={t("Akses akun")}
        options={MODE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
        value={value === null ? "SEMUA" : "PILIHAN"}
        onChange={(mode) => onChange(mode === "SEMUA" ? null : kept)}
        disabled={disabled}
      />

      {value !== null && (
        <div className="mt-3">
          {loading ? (
            <div className="h-24 rounded-xl bg-subtle animate-pulse" aria-busy="true" aria-label={t("Memuat daftar akun")} />
          ) : error ? (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {t(error)}{" "}
              <button type="button" onClick={onRetry} className="underline font-semibold cursor-pointer">
                {t("Coba lagi")}
              </button>
            </p>
          ) : accounts.length === 0 ? (
            <p className="text-[13px] text-muted">{t("Belum ada akun Threads yang bisa dipilih.")}</p>
          ) : (
            <>
              {accounts.length >= SEARCH_FROM && (
                <div className="relative mb-2">
                  <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("Cari nama cabang atau @username")}
                    aria-label={t("Cari akun")}
                    className={cn(INPUT_CLS, "pl-10")}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className="text-xs text-muted tabular-nums" aria-live="polite">
                  {t("{picked} dari {n} akun dipilih", { picked: picked.size, n: accounts.length })}
                </p>
                <button
                  type="button"
                  onClick={toggleFiltered}
                  disabled={disabled || filtered.length === 0}
                  className="h-10 px-2 -mr-2 text-[13px] font-semibold text-accent hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {allFilteredOn ? t("Lepas semua") : t("Pilih semua")}
                </button>
              </div>
              <ul
                aria-label={t("Akun yang boleh diakses")}
                className={cn(
                  "max-h-60 overflow-y-auto overscroll-contain rounded-xl border p-1 space-y-0.5",
                  invalid ? "border-danger" : "border-line"
                )}
              >
                {filtered.map((a) => {
                  const on = picked.has(a.id);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        disabled={disabled}
                        onClick={() => toggle(a.id)}
                        className={cn(
                          "w-full min-h-12 px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 text-left cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                          on ? "bg-accent-soft" : "hover:bg-subtle"
                        )}
                      >
                        <AccountAvatar name={a.displayName} src={a.avatarUrl} size="w-8 h-8" />
                        <span className="flex-1 min-w-0 leading-tight">
                          <span className="block text-sm font-semibold text-fg truncate">{a.outletNama ?? a.displayName}</span>
                          <span className="block text-xs text-muted truncate">{accountHandle(a)}</span>
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "w-5 h-5 shrink-0 rounded-md border-2 inline-flex items-center justify-center",
                            on ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong"
                          )}
                        >
                          {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {filtered.length === 0 && (
                  <li className="py-6 text-center text-[13px] text-muted">{t("Tidak ada akun yang cocok dengan pencarian.")}</li>
                )}
              </ul>
            </>
          )}
          {invalid && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
              {invalid}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
