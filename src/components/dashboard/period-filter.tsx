"use client";

import React, { useEffect, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";
import {
  MAX_CUSTOM_DAYS,
  PERIOD_OPTIONS,
  isoDate,
  todayWIB,
  type PeriodKey,
} from "@/lib/period";
import { cn } from "@/lib/utils";

export interface PeriodValue {
  key: PeriodKey;
  from?: string;
  to?: string;
}

interface PeriodFilterProps {
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
}

const DAY = 86_400_000;

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  // Diisi saat popup dibuka (event handler): Date.now() tidak boleh dipakai saat render/prerender
  const [maxDate, setMaxDate] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const openCustom = () => {
    setMaxDate(isoDate(todayWIB()));
    if (!from || !to) {
      const end = new Date(todayWIB().getTime() - DAY);
      setTo(isoDate(end));
      setFrom(isoDate(new Date(end.getTime() - 6 * DAY)));
    }
    setError("");
    setOpen((v) => !v);
  };

  const apply = () => {
    if (!from || !to) return setError("Isi tanggal awal dan akhir.");
    if (from > to) return setError("Tanggal awal tidak boleh setelah tanggal akhir.");
    const span = (Date.parse(to) - Date.parse(from)) / DAY + 1;
    if (span > MAX_CUSTOM_DAYS) return setError(`Maksimal ${MAX_CUSTOM_DAYS} hari.`);
    setError("");
    setOpen(false);
    onChange({ key: "custom", from, to });
  };

  const btn =
    "h-9 px-3.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap";

  return (
    <div className="relative" ref={boxRef}>
      <div
        role="radiogroup"
        aria-label="Pilih periode"
        className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-subtle overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {PERIOD_OPTIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={value.key === p.key}
            onClick={() => {
              setOpen(false);
              onChange({ key: p.key });
            }}
            className={cn(
              btn,
              value.key === p.key
                ? "bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
                : "text-muted hover:text-fg"
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={value.key === "custom"}
          aria-haspopup="dialog"
          onClick={openCustom}
          className={cn(
            btn,
            "inline-flex items-center gap-1.5",
            value.key === "custom"
              ? "bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
              : "text-muted hover:text-fg"
          )}
        >
          <CalendarRange className="w-4 h-4" />
          Kustom
        </button>
      </div>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-4 shadow-pop">
          <p className="text-sm font-semibold text-fg">Rentang tanggal</p>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="text-xs text-muted">Dari</span>
              <input
                type="date"
                value={from}
                max={maxDate}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full h-10 rounded-lg bg-subtle px-3 text-sm text-fg border border-transparent focus:bg-surface focus:border-accent outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Sampai</span>
              <input
                type="date"
                value={to}
                max={maxDate}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full h-10 rounded-lg bg-subtle px-3 text-sm text-fg border border-transparent focus:bg-surface focus:border-accent outline-none"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 px-3.5 rounded-lg text-sm font-medium text-muted hover:text-fg hover:bg-subtle cursor-pointer transition-colors"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={apply}
              className="h-9 px-4 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold cursor-pointer transition-colors"
            >
              Terapkan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
