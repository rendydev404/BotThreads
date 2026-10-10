"use client";

import React, { useState, useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import {
  Search,
  Check,
  ArrowRight,
  TrendingUp,
  RotateCcw,
} from "lucide-react";

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
}

interface FleetLeaderboardTableProps {
  accounts: LeaderboardAccount[];
  selectedAccount: string;
  onSelectAccount: (username: string) => void;
  onOpenAnalysis: (username?: string) => void;
}

export function FleetLeaderboardTable({
  accounts = [],
  selectedAccount,
  onSelectAccount,
  onOpenAnalysis,
}: FleetLeaderboardTableProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const maxViews = useMemo(() => {
    return Math.max(...accounts.map((a) => a.views || 0), 1);
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase().trim();
    return accounts.filter(
      (a) =>
        a.username.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const displayedAccounts = showAll
    ? filteredAccounts
    : filteredAccounts.slice(0, 8);

  const isFiltered = selectedAccount !== "all";

  return (
    <div className="bg-white dark:bg-[#111827] border border-[#E2E8F0] dark:border-[#1F2937] rounded-2xl overflow-hidden shadow-xs transition-colors">
      {/* Header bar */}
      <div className="p-5 border-b border-[#EDF2F7] dark:border-[#1F2937] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-[#1E293B] dark:text-[#F8FAFC]">
              Peringkat & Performa 32 Akun Cabang
            </h3>
            <span className="text-[11px] font-semibold bg-[#F1F5F9] dark:bg-[#1E293B] text-[#64748B] dark:text-[#94A3B8] px-2 py-0.5 rounded-full">
              {filteredAccounts.length} Akun
            </span>
          </div>
          <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5">
            Pilih cabang untuk memfilter seluruh grafik dan data metrik di atas.
          </p>
        </div>

        {/* Search & Reset Actions */}
        <div className="flex items-center gap-3">
          {/* Custom Search (No Native OS Control) */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari cabang / username..."
              className="w-48 sm:w-56 h-9 pl-9 pr-3 text-xs rounded-xl bg-[#F8FAFC] dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-[#334155] text-[#1E293B] dark:text-[#F8FAFC] placeholder-[#94A3B8] focus:bg-white dark:focus:bg-[#0F172A] focus:border-[#1814F3]/40 focus:outline-none transition-all"
            />
          </div>

          {isFiltered && (
            <button
              type="button"
              onClick={() => onSelectAccount("all")}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F1F5F9] dark:bg-[#1E293B] hover:bg-[#E2E8F0] dark:hover:bg-[#334155] text-[#1E293B] dark:text-[#F8FAFC] text-xs font-semibold cursor-pointer transition-colors"
              title="Reset ke tampilan semua akun"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#64748B] dark:text-[#94A3B8]" />
              <span>Semua Akun</span>
            </button>
          )}
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-[#334155] dark:text-[#CBD5E1]">
          <thead className="bg-[#F8FAFC] dark:bg-[#1E293B]/70 text-[11px] text-[#64748B] dark:text-[#94A3B8] uppercase font-semibold border-b border-[#EDF2F7] dark:border-[#1F2937]">
            <tr>
              <th className="py-3 px-4 w-12 text-center">Rank</th>
              <th className="py-3 px-4">Cabang / Akun Threads</th>
              <th className="py-3 px-4">Postingan</th>
              <th className="py-3 px-4">Total Penayangan (Views)</th>
              <th className="py-3 px-4">Interaksi</th>
              <th className="py-3 px-4">Tingkat ER</th>
              <th className="py-3 px-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] dark:divide-[#1F2937]">
            {displayedAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[#94A3B8]">
                  Tidak ada akun yang sesuai dengan pencarian "{search}".
                </td>
              </tr>
            ) : (
              displayedAccounts.map((acc, index) => {
                const isSelected = selectedAccount === acc.username;
                const viewPercentage = Math.max(
                  4,
                  Math.round((acc.views / maxViews) * 100)
                );

                return (
                  <tr
                    key={acc.id}
                    className={`hover:bg-[#F8FAFC] dark:hover:bg-[#1E293B]/50 transition-colors ${
                      isSelected ? "bg-[#EFF6FF] dark:bg-blue-950/30" : ""
                    }`}
                  >
                    {/* Rank Badge */}
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-extrabold ${
                          index === 0
                            ? "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300"
                            : index === 1
                            ? "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                            : index === 2
                            ? "bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300"
                            : "bg-[#F1F5F9] dark:bg-slate-800 text-[#64748B] dark:text-[#94A3B8]"
                        }`}
                      >
                        {index + 1}
                      </span>
                    </td>

                    {/* Account Info */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#E2E8F0] dark:bg-[#1E293B] overflow-hidden flex items-center justify-center font-bold text-[11px] text-[#475569] dark:text-[#94A3B8] shrink-0 border border-[#CBD5E1] dark:border-[#334155]">
                          {acc.avatarUrl ? (
                            <img
                              src={acc.avatarUrl}
                              alt={acc.displayName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            acc.displayName.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-[#1E293B] dark:text-[#F8FAFC] truncate max-w-[180px]">
                            {acc.displayName}
                          </p>
                          <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
                            @{acc.username}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Posts Count */}
                    <td className="py-3.5 px-4">
                      <span className="font-bold text-[#1E293B] dark:text-[#F8FAFC]">
                        {acc.posts}
                      </span>
                      <span className="text-[11px] text-[#64748B] dark:text-[#94A3B8] ml-1">
                        post
                      </span>
                    </td>

                    {/* Views & Relative Bar */}
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-bold text-[#1E293B] dark:text-[#F8FAFC]">
                            {acc.views.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-[#64748B] dark:text-[#94A3B8]">
                            views
                          </span>
                        </div>
                        <div className="w-28 sm:w-36 h-1.5 bg-[#F1F5F9] dark:bg-[#1E293B] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#1814F3] dark:bg-blue-500 rounded-full"
                            style={{ width: `${viewPercentage}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Interactions */}
                    <td className="py-3.5 px-4">
                      <div className="text-[11px]">
                        <span className="font-bold text-[#1E293B] dark:text-[#F8FAFC]">
                          {(acc.likes + acc.replies + acc.reposts).toLocaleString()}
                        </span>
                        <div className="text-[10px] text-[#64748B] dark:text-[#94A3B8] flex items-center gap-1.5">
                          <span>{acc.likes} suka</span>
                          <span>•</span>
                          <span>{acc.replies} komentar</span>
                        </div>
                      </div>
                    </td>

                    {/* ER */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          acc.er >= 1.0
                            ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        <TrendingUp className="w-3 h-3" />
                        {acc.er}%
                      </span>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 px-4 text-right">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
                          <Check className="w-3.5 h-3.5" />
                          <span>Aktif</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectAccount(acc.username)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-[#1E293B] border border-[#CBD5E1] dark:border-[#334155] hover:border-[#1814F3] dark:hover:border-blue-400 hover:text-[#1814F3] dark:hover:text-blue-400 text-[11px] font-semibold text-[#334155] dark:text-[#CBD5E1] cursor-pointer transition-colors shadow-2xs"
                        >
                          <span>Pilih</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Toggle */}
      {filteredAccounts.length > 8 && (
        <div className="p-3.5 bg-[#F8FAFC] dark:bg-[#1E293B]/40 border-t border-[#EDF2F7] dark:border-[#1F2937] flex items-center justify-between text-xs text-[#64748B] dark:text-[#94A3B8]">
          <span>
            Menampilkan {displayedAccounts.length} dari {filteredAccounts.length}{" "}
            akun cabang
          </span>
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="text-xs font-bold text-[#1814F3] dark:text-blue-400 hover:underline cursor-pointer"
          >
            {showAll ? "Tampilkan Lebih Sedikit (8 Akun)" : "Lihat Seluruh 32 Akun"}
          </button>
        </div>
      )}
    </div>
  );
}
