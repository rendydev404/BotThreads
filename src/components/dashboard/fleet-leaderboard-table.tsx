"use client";

import React, { useState, useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import { Search, Check, RotateCcw } from "lucide-react";
import type { Delta } from "@/lib/report";
import { DeltaBadge } from "@/components/ui/delta-badge";

export interface LeaderboardAccount {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  posts: number;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  er: number;
  /** Perubahan views dibanding periode sebelumnya */
  delta?: Delta;
}

interface FleetLeaderboardTableProps {
  accounts: LeaderboardAccount[];
  selectedAccount: string;
  onSelectAccount: (username: string) => void;
  loading?: boolean;
}

const PREVIEW_COUNT = 8;

export function FleetLeaderboardTable({
  accounts = [],
  selectedAccount,
  onSelectAccount,
  loading = false,
}: FleetLeaderboardTableProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const maxViews = useMemo(
    () => Math.max(...accounts.map((a) => a.views || 0), 1),
    [accounts]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.username.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const shown = showAll || search ? filtered : filtered.slice(0, PREVIEW_COUNT);
  const isFiltered = selectedAccount !== "all";

  return (
    <section className="card overflow-hidden">
      <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-fg">Peringkat cabang</h3>
          <p className="text-[13px] text-muted mt-0.5">
            Diurutkan dari penayangan terbanyak pada periode terpilih. Klik
            baris untuk melihat satu cabang.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isFiltered && (
            <button
              type="button"
              onClick={() => onSelectAccount("all")}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-subtle hover:bg-line text-sm font-medium text-fg cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Semua akun
            </button>
          )}
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari cabang…"
              aria-label="Cari cabang"
              className="w-44 sm:w-52 h-9 pl-9 pr-3 text-sm rounded-lg bg-subtle border border-transparent text-fg placeholder-faint focus:bg-surface focus:border-accent focus:outline-none transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-xs font-medium text-muted border-y border-line bg-subtle/60">
              <th className="py-2.5 pl-5 pr-2 w-12">#</th>
              <th className="py-2.5 px-3">Cabang</th>
              <th className="py-2.5 px-3 text-right">Postingan</th>
              <th className="py-2.5 px-3 min-w-44">Penayangan</th>
              <th className="py-2.5 px-3 text-right">Interaksi</th>
              <th className="py-2.5 px-3 text-right pr-5">ER</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td colSpan={6} className="p-3">
                    <div className="h-8 rounded-md bg-subtle animate-pulse" />
                  </td>
                </tr>
              ))
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-muted">
                  Tidak ada cabang yang cocok dengan “{search}”.
                </td>
              </tr>
            ) : (
              shown.map((acc, index) => {
                const isSelected = selectedAccount === acc.username;
                const pct = Math.max(3, Math.round((acc.views / maxViews) * 100));
                const interactions = acc.likes + acc.replies + acc.reposts;

                return (
                  <tr
                    key={acc.id}
                    onClick={() => onSelectAccount(acc.username)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "bg-accent-soft" : "hover:bg-subtle/70"
                    }`}
                  >
                    <td className="py-3 pl-5 pr-2 text-muted font-medium tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-subtle overflow-hidden flex items-center justify-center text-xs font-semibold text-muted shrink-0">
                          {acc.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={acc.avatarUrl}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            acc.displayName.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-fg truncate max-w-[200px]">
                            {acc.displayName}
                          </p>
                          <p className="text-xs text-muted truncate">
                            @{acc.username}
                          </p>
                        </div>
                        {isSelected && (
                          <Check className="w-4 h-4 text-accent shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-fg">
                      {formatNumber(acc.posts)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-3">
                        <span className="w-14 tabular-nums font-medium text-fg shrink-0">
                          {formatNumber(acc.views)}
                        </span>
                        <DeltaBadge delta={acc.delta} className="w-12 shrink-0" />
                        <div className="flex-1 h-1.5 bg-subtle rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-fg">
                      {formatNumber(interactions)}
                    </td>
                    <td className="py-3 px-3 pr-5 text-right tabular-nums">
                      <span
                        className={
                          acc.er >= 1 ? "text-success font-semibold" : "text-muted"
                        }
                      >
                        {acc.er}%
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!search && filtered.length > PREVIEW_COUNT && (
        <div className="px-5 py-3 border-t border-line flex items-center justify-between text-sm">
          <span className="text-muted">
            {shown.length} dari {filtered.length} cabang
          </span>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-medium text-accent hover:underline cursor-pointer"
          >
            {showAll ? "Tampilkan lebih sedikit" : "Lihat semua"}
          </button>
        </div>
      )}
    </section>
  );
}
