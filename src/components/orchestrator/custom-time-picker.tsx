"use client";

import React from "react";
import { Clock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { isValidTime } from "./orchestrator-store";

interface Props {
  mode: "auto" | "fixed";
  time: string;
  onMode: (mode: "auto" | "fixed") => void;
  onTime: (time: string) => void;
}

const MODES = [
  { key: "auto", label: "Jam ramai tiap akun", Icon: Sparkles },
  { key: "fixed", label: "Jam yang sama", Icon: Clock },
] as const;

/** "1730" -> "17:30" saat mengetik; hanya angka dan titik dua yang diterima. */
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** Pilihan jadwal: jam ramai tiap akun (dari data postingannya) atau satu jam manual untuk semua. */
export function CustomTimePicker({ mode, time, onMode, onTime }: Props) {
  const invalid = mode === "fixed" && time.length > 0 && !isValidTime(time);

  return (
    <div>
      <span className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Waktu Posting</span>
      <div role="tablist" aria-label="Waktu posting" className="flex p-1 rounded-lg bg-subtle">
        {MODES.map(({ key, label, Icon }) => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onMode(key)}
              className={cn(
                "flex-1 h-8 px-3 rounded-md text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer",
                active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              )}
            >
              <Icon className={cn("w-3.5 h-3.5", active && key === "auto" && "text-accent")} />
              {label}
            </button>
          );
        })}
      </div>

      {mode === "auto" ? (
        <p className="mt-2 text-xs text-muted leading-relaxed">
          Tiap akun dijadwalkan di jamnya sendiri: agen memilih dari jam yang views-nya di atas rata-rata akun itu
          (60 hari terakhir) dan menghindari bentrok dengan jadwal yang sudah ada.
        </p>
      ) : (
        <div className="mt-2">
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              type="text"
              inputMode="numeric"
              placeholder="HH:MM (WIB)"
              value={time}
              onChange={(e) => onTime(maskTime(e.target.value))}
              aria-label="Jam posting WIB"
              aria-invalid={invalid}
              className={cn(
                "w-full h-10 pl-9 pr-3 bg-surface border rounded-lg text-sm text-fg placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
                invalid ? "border-danger" : "border-line hover:border-muted"
              )}
            />
          </div>
          <p className={cn("mt-1.5 text-xs", invalid ? "text-danger font-medium" : "text-muted")}>
            {invalid
              ? "Format jam harus HH:MM, misalnya 17:30."
              : "Semua akun tayang di jam ini (WIB). Akun yang bentrok dengan jadwalnya digeser ke hari berikutnya."}
          </p>
        </div>
      )}
    </div>
  );
}
