"use client";

import React, { useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BestHourDTO } from "@/lib/content-types";
import { SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS, SLOT_MIN_LEAD_MS } from "@/lib/content-config";
import { WIB_OFFSET_MS, formatWibFull, formatWibLabel, wibAt, wibParts } from "@/lib/scheduling";
import { ModalButton, ModalShell } from "./modal-shell";

/** `now` = langsung diposting; `at` = jadwal (ISO UTC) atau belum dipilih. */
export type ScheduleValue = { mode: "now" } | { mode: "at"; at: string | null };

interface SchedulePickerProps {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  bestHours?: BestHourDTO[];
  /** Saran jam dari AI (ISO UTC). */
  suggestedAt?: string | null;
  /** Sembunyikan opsi "Sekarang" (mis. saat mengedit jadwal). */
  allowNow?: boolean;
  disabled?: boolean;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtMult = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;

/** Waktu WIB (y, m 0-11, d, h, min) -> Date UTC. */
const fromWib = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(Date.UTC(y, m, d, h, min) - WIB_OFFSET_MS);

export function SchedulePicker({
  value,
  onChange,
  bestHours = [],
  suggestedAt,
  allowNow = true,
  disabled,
}: SchedulePickerProps) {
  const [open, setOpen] = useState(false);
  // Keadaan dialog kalender: dihitung saat dibuka (bukan saat render) agar tidak memakai waktu saat prerender.
  const [cal, setCal] = useState({ y: 2026, m: 0, d: 1, h: 12, min: 0, todayKey: 0, maxKey: 0 });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState({ y: 2026, m: 0 });

  const selectedAt = value.mode === "at" && value.at ? new Date(value.at) : null;

  const pickHour = (hour: number) => {
    const now = new Date();
    let t = wibAt(now, 0, hour);
    if (t.getTime() < now.getTime() + SLOT_MIN_LEAD_MS) t = wibAt(now, 1, hour);
    onChange({ mode: "at", at: t.toISOString() });
  };

  const openCalendar = () => {
    const now = new Date();
    const base = selectedAt ?? new Date(now.getTime() + 60 * 60_000);
    const p = wibParts(base);
    const today = wibParts(now);
    const max = wibParts(new Date(now.getTime() + SCHEDULE_MAX_LEAD_MS - 24 * 3600_000));
    setCal({
      y: p.y,
      m: p.m,
      d: p.d,
      h: p.h,
      min: Math.round(p.min / 5) * 5 === 60 ? 55 : Math.round(p.min / 5) * 5,
      todayKey: Date.UTC(today.y, today.m, today.d),
      maxKey: Date.UTC(max.y, max.m, max.d),
    });
    setView({ y: p.y, m: p.m });
    setError(null);
    setOpen(true);
  };

  const confirm = () => {
    const t = fromWib(cal.y, cal.m, cal.d, cal.h, cal.min);
    if (t.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MS) {
      setError("Jadwal harus minimal 2 menit dari sekarang.");
      return;
    }
    onChange({ mode: "at", at: t.toISOString() });
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(Date.UTC(v.y, v.m + delta, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  };

  // Grid kalender (Senin sebagai awal pekan).
  const first = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const chip = (active: boolean) =>
    cn(
      "h-9 px-3 rounded-full border text-[13px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed",
      active ? "bg-accent text-on-accent border-accent" : "bg-surface text-fg border-line-strong hover:border-accent"
    );

  return (
    <div className="space-y-2.5">
      {allowNow && (
        <div role="tablist" aria-label="Waktu posting" className="inline-flex p-1 rounded-full bg-subtle">
          {(
            [
              { key: "now", label: "Sekarang", Icon: Send },
              { key: "at", label: "Jadwalkan", Icon: CalendarClock },
            ] as const
          ).map(({ key, label, Icon }) => {
            const active = value.mode === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => onChange(key === "now" ? { mode: "now" } : { mode: "at", at: value.mode === "at" ? value.at : null })}
                className={cn(
                  "h-8 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer",
                  active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {value.mode === "at" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {suggestedAt && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ mode: "at", at: suggestedAt })}
                className={chip(value.at === suggestedAt)}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Saran AI · {formatWibLabel(new Date(suggestedAt))}
              </button>
            )}
            {bestHours.map((b) => {
              const active = selectedAt ? wibParts(selectedAt).h === b.hour && wibParts(selectedAt).min === 0 : false;
              return (
                <button key={b.hour} type="button" disabled={disabled} onClick={() => pickHour(b.hour)} className={chip(active)}>
                  {pad2(b.hour)}.00{b.multiplier ? ` · ${fmtMult(b.multiplier)}` : ""}
                </button>
              );
            })}
            <button type="button" disabled={disabled} onClick={openCalendar} className={chip(false)}>
              <CalendarClock className="w-3.5 h-3.5" />
              Pilih tanggal dan jam
            </button>
          </div>
          <p className={cn("text-[13px]", selectedAt ? "text-fg font-medium" : "text-muted")}>
            {selectedAt ? `Tayang ${formatWibFull(selectedAt)}` : "Pilih jam terbaik atau tentukan tanggal dan jam sendiri."}
          </p>
        </div>
      )}

      <ModalShell
        open={open}
        onClose={() => setOpen(false)}
        title="Pilih tanggal dan jam"
        description="Semua waktu dalam WIB (Asia/Jakarta)."
        footer={
          <>
            <ModalButton onClick={() => setOpen(false)}>Batal</ModalButton>
            <ModalButton variant="primary" onClick={confirm}>
              Pakai jadwal ini
            </ModalButton>
          </>
        }
      >
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Bulan sebelumnya"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-subtle cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-bold text-fg">
            {MONTHS[view.m]} {view.y}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Bulan berikutnya"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-subtle cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {DOW.map((d) => (
            <span key={d} className="text-[11px] font-semibold text-faint py-1">
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`b${i}`} />;
            const key = Date.UTC(view.y, view.m, day);
            const out = key < cal.todayKey || key > cal.maxKey;
            const sel = cal.y === view.y && cal.m === view.m && cal.d === day;
            const isToday = key === cal.todayKey;
            return (
              <button
                key={day}
                type="button"
                disabled={out}
                onClick={() => setCal((c) => ({ ...c, y: view.y, m: view.m, d: day }))}
                aria-pressed={sel}
                aria-label={`${day} ${MONTHS[view.m]} ${view.y}`}
                className={cn(
                  "h-10 rounded-xl text-sm font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed",
                  sel ? "bg-accent text-on-accent font-bold" : "text-fg hover:bg-subtle",
                  isToday && !sel && "border border-accent text-accent"
                )}
              >
                {day}
              </button>
            );
          })}
        </div>

        <p className="mt-4 mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Jam</p>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 24 }, (_, h) => (
            <button
              key={h}
              type="button"
              onClick={() => setCal((c) => ({ ...c, h }))}
              aria-pressed={cal.h === h}
              className={cn(
                "h-9 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors",
                cal.h === h ? "bg-accent text-on-accent" : "bg-subtle text-fg hover:bg-line"
              )}
            >
              {pad2(h)}
            </button>
          ))}
        </div>
        <p className="mt-3 mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Menit</p>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setCal((c) => ({ ...c, min: m }))}
              aria-pressed={cal.min === m}
              className={cn(
                "h-9 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors",
                cal.min === m ? "bg-accent text-on-accent" : "bg-subtle text-fg hover:bg-line"
              )}
            >
              {pad2(m)}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm font-semibold text-fg">
          {formatWibFull(fromWib(cal.y, cal.m, cal.d, cal.h, cal.min))}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}
      </ModalShell>
    </div>
  );
}
