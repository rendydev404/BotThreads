"use client";

import React from "react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDashed,
  Eye,
  Info,
  Loader2,
  Minus,
  PenLine,
  SkipForward,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SLOT_KIND_LABEL,
  SLOT_STATUS_LABEL,
  type AutopilotMode,
  type SlotKind,
  type SlotStatus,
} from "@/lib/autopilot-types";
import { wibParts } from "@/lib/scheduling";

/* ------------------------------------------------------------------ pembantu teks */

export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "11.07" (WIB) dari ISO UTC. */
export function timeOf(iso: string): string {
  const p = wibParts(new Date(iso));
  return `${pad2(p.h)}.${pad2(p.min)}`;
}

/** "@username" atau nama tampilan bila username belum ada. */
export const accountHandle = (a: { username: string | null; displayName: string }): string =>
  `@${a.username ?? a.displayName}`;

/**
 * Nama akun dengan titik potong baris setelah "." dan "_" (lewat <wbr>, jadi teks yang disalin tetap
 * bersih): nama panjang turun ke baris kedua di batas yang wajar, bukan terpotong di tengah kata.
 */
export function HandleText({ account }: { account: { username: string | null; displayName: string } }) {
  const parts = accountHandle(account).match(/[^._]*[._]?/g)?.filter(Boolean) ?? [];
  return (
    <>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </React.Fragment>
      ))}
    </>
  );
}

/** Lama waktu untuk kalimat ("5 menit", "2 jam", "3 hari"). */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "kurang dari 1 menit";
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} jam ${rest} menit` : `${hours} jam`;
  }
  return `${Math.floor(hours / 24)} hari`;
}

const DAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const DAY_LABELS: readonly string[] = DAY_SHORT;

/** Hari (0 = Minggu) dari kunci "YYYY-MM-DD"; murni, tidak bergantung jam sekarang. */
export function dowOfDayKey(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00Z`).getUTCDay();
}

/** "Rab, 14 Okt" dari kunci hari "YYYY-MM-DD". */
export function dayKeyLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return `${DAY_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/* ------------------------------------------------------------------ banner */

type Tone = "warning" | "danger" | "success" | "info";

const TONE_CLASS: Record<Tone, string> = {
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  success: "bg-success-soft text-success",
  info: "bg-subtle text-muted",
};

export function Banner({
  tone,
  children,
  onClose,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-xl p-3.5 text-sm font-medium", TONE_CLASS[tone], className)}
    >
      <Icon className="w-[18px] h-[18px] mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 break-words">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup pemberitahuan"
          className="shrink-0 -m-2 w-9 h-9 rounded-full inline-flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ status & jenis slot */

interface StatusStyle {
  /** Kelas chip (latar + teks). */
  chip: string;
  /** Kelas titik pada garis waktu. */
  dot: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export const SLOT_STATUS_STYLE: Record<SlotStatus, StatusStyle> = {
  DIRENCANAKAN: { chip: "bg-surface text-muted border border-line-strong", dot: "bg-surface border-2 border-faint", Icon: CircleDashed },
  MENULIS: { chip: "bg-accent-soft text-accent", dot: "bg-accent animate-pulse", Icon: PenLine },
  MENUNGGU_TINJAU: { chip: "bg-warning-soft text-warning", dot: "bg-warning", Icon: Eye },
  TERANTRE: { chip: "bg-accent-soft text-accent", dot: "bg-accent", Icon: CalendarClock },
  TERBIT: { chip: "bg-success-soft text-success", dot: "bg-success", Icon: CheckCircle2 },
  GAGAL: { chip: "bg-danger-soft text-danger", dot: "bg-danger", Icon: XCircle },
  DILEWATI: { chip: "bg-subtle text-muted", dot: "bg-surface border-2 border-muted", Icon: SkipForward },
  DIBATALKAN: { chip: "bg-subtle text-muted", dot: "bg-surface border-2 border-muted", Icon: Ban },
};

/** Slot yang tidak jadi tayang: titiknya berlubang dan dicoret. */
export const isStruck = (status: SlotStatus): boolean => status === "DILEWATI" || status === "DIBATALKAN";

export function SlotStatusChip({ status, className }: { status: SlotStatus; className?: string }) {
  const { chip, Icon } = SLOT_STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap",
        chip,
        isStruck(status) && "line-through decoration-1",
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {SLOT_STATUS_LABEL[status]}
    </span>
  );
}

export function SlotKindChip({ kind, className }: { kind: SlotKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap",
        kind === "EKSPLORASI" ? "bg-accent-soft text-accent" : "bg-subtle text-muted",
        className
      )}
    >
      {SLOT_KIND_LABEL[kind]}
    </span>
  );
}

/* ------------------------------------------------------------------ kontrol kustom */

/** Kotak centang kustom; area sentuh 40px, kotak terlihat 20px. */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group w-10 h-10 -m-2.5 shrink-0 rounded-lg inline-flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          "w-5 h-5 rounded-md border-2 inline-flex items-center justify-center transition-colors",
          on ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong group-hover:border-accent"
        )}
      >
        {indeterminate ? (
          <Minus className="w-3.5 h-3.5" strokeWidth={3} />
        ) : checked ? (
          <Check className="w-3.5 h-3.5" strokeWidth={3} />
        ) : null}
      </span>
    </button>
  );
}

export interface SegmentedOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
  /** Kelas saat terpilih (default: permukaan putih). */
  activeClass?: string;
}

/** Pilihan tunggal berbentuk segmen; tiap segmen tombol dengan aria-pressed. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  busyValue,
  disabled,
  fit = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (next: T) => void;
  ariaLabel: string;
  /** Segmen yang sedang disimpan (menampilkan pemutar). */
  busyValue?: T | null;
  disabled?: boolean;
  /** Lebar segmen mengikuti panjang labelnya (untuk kolom sempit), bukan dibagi rata. */
  fit?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex p-1 rounded-xl bg-subtle", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            title={o.title}
            disabled={disabled || o.disabled}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "min-w-0 h-10 xl:h-8 rounded-lg text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
              fit ? "flex-auto px-1.5" : "flex-1 px-2",
              active ? (o.activeClass ?? "bg-surface text-fg shadow-sm") : "text-muted hover:text-fg"
            )}
          >
            {busyValue === o.value && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Segmen mode autopilot dengan warna per mode supaya daftar akun mudah dipindai. */
export const MODE_ACTIVE_CLASS: Record<AutopilotMode, string> = {
  MATI: "bg-surface text-fg shadow-sm",
  TINJAU: "bg-warning-soft text-warning shadow-sm",
  OTOMATIS: "bg-accent text-on-accent shadow-sm",
};

export function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="h-10 px-6 rounded-full border border-line-strong text-sm font-semibold text-fg hover:border-accent hover:text-accent transition-colors cursor-pointer inline-flex items-center gap-2 disabled:opacity-60"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Muat lagi
      </button>
    </div>
  );
}

export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card p-4 animate-pulse">
          <div className="h-4 w-1/3 rounded bg-subtle" />
          <div className="mt-3 h-3 w-full rounded bg-subtle" />
          <div className="mt-2 h-3 w-2/3 rounded bg-subtle" />
        </div>
      ))}
    </div>
  );
}

/** Saklar nyala/mati dengan area sentuh 48x40 dan indikator sibuk. */
export function Switch({ on, onChange, label, busy, disabled }: { on: boolean; onChange: (next: boolean) => void; label: string; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || busy}
      onClick={() => onChange(!on)}
      className="w-12 h-10 -my-2 shrink-0 inline-flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className={cn("relative w-10 h-6 rounded-full transition-colors", on ? "bg-accent" : "bg-line-strong")}>
        <span
          className={cn(
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow-sm transition-transform inline-flex items-center justify-center",
            on && "translate-x-4"
          )}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin text-muted" />}
        </span>
      </span>
    </button>
  );
}
