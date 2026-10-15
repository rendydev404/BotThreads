"use client";

import React from "react";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { MONTH_LONG, daysInMonth, parseDayKey, toDayKey } from "./format";

const DAY_MS = 86_400_000;
/** Tahun yang ditawarkan setelah tahun berjalan. */
const YEARS_AHEAD = 2;

const utcOf = (key: string | null | undefined): number | null => {
  const p = parseDayKey(key);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null;
};

/** Kunci hari `days` hari setelah `key` (boleh negatif); `key` yang salah bentuk dikembalikan apa adanya. */
export function addDays(key: string, days: number): string {
  const t = utcOf(key);
  if (t === null) return key;
  const d = new Date(t + days * DAY_MS);
  return toDayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Selisih hari `to - from`; null bila salah satu kunci salah bentuk. */
export function dayDiff(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = utcOf(from);
  const b = utcOf(to);
  return a === null || b === null ? null : Math.round((b - a) / DAY_MS);
}

const MONTH_OPTIONS: DropdownOption<number>[] = MONTH_LONG.map((label, i) => ({ value: i + 1, label }));

interface DayFieldProps {
  /** Nama kelompok untuk pembaca layar, mis. "Tanggal berakhir". */
  label: string;
  /** "YYYY-MM-DD". */
  value: string;
  onChange: (next: string) => void;
  /** Hari ini (WIB), "YYYY-MM-DD": menentukan rentang tahun yang ditawarkan. */
  today: string;
  disabled?: boolean;
}

/**
 * Pemilih hari kustom (pengganti input tanggal bawaan): tiga dropdown tanggal, bulan, dan tahun.
 * Mengganti bulan atau tahun menjepit tanggal ke hari terakhir bulan itu (31 Jan lalu Feb = 28/29 Feb).
 */
export function DayField({ label, value, onChange, today, disabled }: DayFieldProps) {
  const now = parseDayKey(today);
  const cur = parseDayKey(value) ?? now;
  if (!cur) return null;

  const thisYear = now?.y ?? cur.y;
  const firstYear = Math.min(cur.y, thisYear);
  const lastYear = Math.max(cur.y, thisYear + YEARS_AHEAD);
  const yearOptions: DropdownOption<number>[] = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({
    value: firstYear + i,
    label: String(firstYear + i),
  }));
  const dayOptions: DropdownOption<number>[] = Array.from({ length: daysInMonth(cur.y, cur.m) }, (_, i) => ({
    value: i + 1,
    label: String(i + 1),
  }));

  const set = (y: number, m: number, d: number) => onChange(toDayKey(y, m, Math.min(d, daysInMonth(y, m))));

  return (
    <div role="group" aria-label={label} className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] gap-2">
      <Dropdown ariaLabel="Tanggal" value={cur.d} options={dayOptions} onChange={(d) => set(cur.y, cur.m, d)} disabled={disabled} />
      <Dropdown ariaLabel="Bulan" value={cur.m} options={MONTH_OPTIONS} onChange={(m) => set(cur.y, m, cur.d)} disabled={disabled} />
      <Dropdown
        ariaLabel="Tahun"
        value={cur.y}
        options={yearOptions}
        onChange={(y) => set(y, cur.m, cur.d)}
        disabled={disabled}
        align="right"
      />
    </div>
  );
}
