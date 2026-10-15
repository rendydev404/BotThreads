"use client";

import React from "react";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { ControlLabel } from "@/components/settings/fields";
import { MONTH_LONG, daysInMonth, formatDayKey, parseDayKey, toDayKey } from "@/components/settings/format";
import { weekdayName } from "./moment-dates";

const MONTH_OPTIONS: DropdownOption<number>[] = MONTH_LONG.map((label, i) => ({ value: i + 1, label }));

interface DayPickerProps {
  label: string;
  /** Kunci hari "YYYY-MM-DD". */
  value: string;
  onChange: (next: string) => void;
  /** Tahun yang ditawarkan; tahun pada `value` selalu ikut tampil. */
  years: number[];
  disabled?: boolean;
}

/**
 * Pemilih hari kustom (pengganti <input type="date">): tiga dropdown tanggal, bulan, tahun. Tanggal
 * dijepit ke jumlah hari bulan terpilih, jadi hasilnya selalu kunci hari yang valid.
 */
export function DayPicker({ label, value, onChange, years, disabled }: DayPickerProps) {
  const parsed = parseDayKey(value) ?? { y: years[0], m: 1, d: 1 };
  const y = parsed.y;
  const m = parsed.m;
  const d = Math.min(parsed.d, daysInMonth(y, m));

  const dayOptions: DropdownOption<number>[] = Array.from({ length: daysInMonth(y, m) }, (_, i) => ({
    value: i + 1,
    label: String(i + 1),
  }));
  const yearOptions: DropdownOption<number>[] = [...new Set([...years, y])]
    .sort((a, b) => a - b)
    .map((year) => ({ value: year, label: String(year) }));

  const pick = (year: number, month: number, day: number) =>
    onChange(toDayKey(year, month, Math.min(day, daysInMonth(year, month))));

  return (
    <div role="group" aria-label={label}>
      <ControlLabel>{label}</ControlLabel>
      <div className="grid grid-cols-[4.75rem_minmax(0,1fr)_5.75rem] gap-2">
        <Dropdown<number>
          ariaLabel={`${label}, tanggal`}
          value={d}
          options={dayOptions}
          onChange={(next) => pick(y, m, next)}
          disabled={disabled}
        />
        <Dropdown<number>
          ariaLabel={`${label}, bulan`}
          value={m}
          options={MONTH_OPTIONS}
          onChange={(next) => pick(y, next, d)}
          disabled={disabled}
        />
        <Dropdown<number>
          ariaLabel={`${label}, tahun`}
          value={y}
          options={yearOptions}
          onChange={(next) => pick(next, m, d)}
          disabled={disabled}
          align="right"
        />
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {weekdayName(toDayKey(y, m, d))}, {formatDayKey(toDayKey(y, m, d))}
      </p>
    </div>
  );
}
