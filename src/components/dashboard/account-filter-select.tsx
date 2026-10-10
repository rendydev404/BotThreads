"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, Globe, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AccountItem {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  _count?: {
    postStats: number;
    dailyStats: number;
  };
}

interface AccountFilterSelectProps {
  accounts: AccountItem[];
  selectedAccount: string; // 'all' or username
  onSelectAccount: (username: string) => void;
  totalAccounts?: number;
}

export function AccountFilterSelect({
  accounts,
  selectedAccount,
  onSelectAccount,
  totalAccounts = 32,
}: AccountFilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter accounts by search query
  const filteredAccounts = accounts.filter((acc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      acc.username?.toLowerCase().includes(q) ||
      acc.displayName.toLowerCase().includes(q)
    );
  });

  const isAllSelected = selectedAccount === "all" || !selectedAccount;
  const currentSelectedObj = isAllSelected
    ? null
    : accounts.find(
        (a) => a.username?.toLowerCase() === selectedAccount.toLowerCase()
      );

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Custom Trigger Button (No native select) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:border-[#1814F3]/40 shadow-xs hover:shadow-sm text-left transition-all cursor-pointer group"
      >
        {isAllSelected ? (
          <div className="w-8 h-8 rounded-lg bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#F1F5F9] shrink-0 border border-[#E2E8F0]">
            {currentSelectedObj?.avatarUrl ? (
              <img
                src={currentSelectedObj.avatarUrl}
                alt={currentSelectedObj.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[#1814F3]">
                {currentSelectedObj?.displayName.slice(0, 2).toUpperCase() || "SS"}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col min-w-0 pr-2">
          <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
            Filter Tampilan
          </span>
          <span className="text-xs font-bold text-[#1E293B] truncate max-w-[170px] sm:max-w-[210px]">
            {isAllSelected
              ? `Semua Akun (${totalAccounts})`
              : currentSelectedObj?.displayName || `@${selectedAccount}`}
          </span>
        </div>

        <ChevronDown
          className={cn(
            "w-4 h-4 text-[#64748B] transition-transform duration-200 shrink-0",
            isOpen && "rotate-180 text-[#1814F3]"
          )}
        />
      </button>

      {/* Custom Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-white border border-[#E2E8F0] shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Custom Search Input */}
          <div className="p-3 border-b border-[#F1F5F9] bg-[#F8FAFC]">
            <div className="relative flex items-center">
              <Search className="absolute left-3 w-4 h-4 text-[#94A3B8]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari cabang atau username..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white border border-[#E2E8F0] text-[#1E293B] placeholder-[#94A3B8] focus:outline-none focus:border-[#1814F3] transition-colors"
                autoFocus
              />
            </div>
          </div>

          {/* Account Items List */}
          <div className="max-h-72 overflow-y-auto p-2 space-y-1">
            {/* Option 1: Semua Akun */}
            <button
              type="button"
              onClick={() => {
                onSelectAccount("all");
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors cursor-pointer",
                isAllSelected
                  ? "bg-[#1814F3]/10 text-[#1814F3]"
                  : "hover:bg-[#F4F7FE] text-[#343C6A]"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    isAllSelected ? "bg-[#1814F3] text-white" : "bg-[#EDF2F7] text-[#718EBF]"
                  )}
                >
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold leading-tight">
                    Semua Akun ({totalAccounts})
                  </p>
                  <p className="text-[11px] text-[#718EBF]">
                    Agregasi performa jaringan Threads
                  </p>
                </div>
              </div>
              {isAllSelected && <Check className="w-4 h-4 text-[#1814F3]" />}
            </button>

            <div className="h-px bg-[#EDF2F7] my-1" />

            {/* Individual Accounts */}
            {filteredAccounts.map((acc) => {
              const isSelected =
                !isAllSelected &&
                acc.username?.toLowerCase() === selectedAccount.toLowerCase();

              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    if (acc.username) {
                      onSelectAccount(acc.username);
                    }
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[#1814F3]/10 text-[#1814F3]"
                      : "hover:bg-[#F4F7FE] text-[#343C6A]"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-[#EDF2F7] shrink-0 border border-[#EDF2F7]">
                      {acc.avatarUrl ? (
                        <img
                          src={acc.avatarUrl}
                          alt={acc.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-[#1814F3]">
                          {acc.displayName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-tight truncate">
                        {acc.displayName}
                      </p>
                      <p className="text-[11px] text-[#718EBF] truncate">
                        @{acc.username}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#EDF2F7] text-[#718EBF]">
                      {acc._count?.postStats || 0} posts
                    </span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-[#1814F3]" />
                    )}
                  </div>
                </button>
              );
            })}

            {filteredAccounts.length === 0 && (
              <div className="py-6 text-center text-xs text-[#718EBF]">
                Tidak ada akun yang cocok dengan "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
