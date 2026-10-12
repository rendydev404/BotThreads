"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { REASON_LABEL } from "@/lib/content-types";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";

interface Props {
  value: string;
  onChange: (val: string) => void;
}

export function CustomDropdown({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // Daftar akun dibagi dengan kartu lain (cache 30 detik), jadi membuka dropdown tidak memicu fetch baru.
  const { accounts, loading } = usePublishAccounts();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const ready = accounts.filter((a) => a.ready).length;
  const selected = accounts.find((a) => a.id === value);
  const allLabel = loading ? "Semua akun" : `Semua akun siap (${ready})`;

  return (
    <div className="relative" ref={ref}>
      <span className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Target Akun</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between h-10 px-3 bg-surface border border-line rounded-lg text-sm text-fg hover:border-muted transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected ? (
            <AccountAvatar name={selected.displayName} src={selected.avatarUrl} size="w-5 h-5" />
          ) : (
            <Users className="w-4 h-4 text-accent shrink-0" />
          )}
          <span className="truncate">{selected ? `@${selected.username ?? selected.displayName}` : allLabel}</span>
        </span>
        <ChevronDown className={cn("w-4 h-4 text-muted shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-10 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-surface border border-line rounded-lg shadow-lg py-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === "all"}
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-subtle text-fg cursor-pointer"
          >
            <Users className="w-4 h-4 text-accent" />
            <span className="font-medium">{allLabel}</span>
          </button>
          <div className="h-px bg-line my-1" />
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={value === a.id}
              disabled={!a.ready}
              onClick={() => {
                onChange(a.id);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-fg hover:bg-subtle cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <AccountAvatar name={a.displayName} src={a.avatarUrl} size="w-5 h-5" />
              <span className="truncate">@{a.username ?? a.displayName}</span>
              {!a.ready && a.reason && (
                <span className="ml-auto shrink-0 text-xs text-muted">{REASON_LABEL[a.reason]}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
