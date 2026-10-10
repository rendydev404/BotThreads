"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, Globe } from "lucide-react";
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
        className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-surface border border-line hover:border-accent hover: text-left transition-all cursor-pointer group"
      >
        {isAllSelected ? (
          <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Globe className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-subtle shrink-0 border border-line">
            {currentSelectedObj?.avatarUrl ? (
              <img
                src={currentSelectedObj.avatarUrl}
                alt={currentSelectedObj.displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-accent">
                {currentSelectedObj?.displayName.slice(0, 2).toUpperCase() || "SS"}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col min-w-0 pr-2">
          <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
            Filter Tampilan
          </span>
          <span className="text-xs font-bold text-fg truncate max-w-[170px] sm:max-w-[210px]">
            {isAllSelected
              ? `Semua Akun (${totalAccounts})`
              : currentSelectedObj?.displayName || `@${selectedAccount}`}
          </span>
        </div>

        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted transition-transform duration-200 shrink-0",
            isOpen && "rotate-180 text-accent"
          )}
        />
      </button>

      {/* Custom Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl bg-surface border border-line z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Custom Search Input */}
          <div className="p-3 border-b border-line bg-subtle">
            <div className="relative flex items-center">
              <Search className="absolute left-3 w-4 h-4 text-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari cabang atau username..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-surface border border-line text-fg placeholder-faint focus:outline-none focus:border-accent transition-colors"
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
                  ? "bg-accent-soft text-accent"
                  : "hover:bg-subtle text-fg"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    isAllSelected ? "bg-accent text-on-accent" : "bg-subtle text-muted"
                  )}
                >
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold leading-tight">
                    Semua Akun ({totalAccounts})
                  </p>
                  <p className="text-[11px] text-muted">
                    Agregasi performa jaringan Threads
                  </p>
                </div>
              </div>
              {isAllSelected && <Check className="w-4 h-4 text-accent" />}
            </button>

            <div className="h-px bg-subtle my-1" />

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
                      ? "bg-accent-soft text-accent"
                      : "hover:bg-subtle text-fg"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-subtle shrink-0 border border-line">
                      {acc.avatarUrl ? (
                        <img
                          src={acc.avatarUrl}
                          alt={acc.displayName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-bold text-accent">
                          {acc.displayName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold leading-tight truncate">
                        {acc.displayName}
                      </p>
                      <p className="text-[11px] text-muted truncate">
                        @{acc.username}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-subtle text-muted">
                      {acc._count?.postStats || 0} posts
                    </span>
                    {isSelected && (
                      <Check className="w-4 h-4 text-accent" />
                    )}
                  </div>
                </button>
              );
            })}

            {filteredAccounts.length === 0 && (
              <div className="py-6 text-center text-xs text-muted">
                Tidak ada akun yang cocok dengan "{searchQuery}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
