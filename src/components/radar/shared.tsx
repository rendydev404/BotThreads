"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Database,
  Flame,
  Globe,
  Lightbulb,
  Lock,
  RefreshCw,
  RotateCw,
  TrendingUp,
} from "lucide-react";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { cn } from "@/lib/utils";
import { SIGNAL_SOURCE_LABEL, type SignalSource } from "@/lib/radar-types";

/* ------------------------------------------------------------------ tombol */

export const BTN =
  "h-10 px-4 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
export const BTN_PRIMARY = "bg-accent text-on-accent hover:bg-accent-hover";
export const BTN_OUTLINE = "border border-line-strong text-fg hover:border-accent hover:text-accent";
export const BTN_DANGER = "border border-danger/50 text-danger hover:bg-danger-soft";
/** Tombol ikon 40px (area sentuh penuh) untuk aksi baris. */
export const ICON_BTN =
  "w-10 h-10 shrink-0 rounded-full inline-flex items-center justify-center text-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

export function RefreshButton({ onClick, busy, disabled }: { onClick: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="shrink-0 h-10 px-3.5 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center gap-1.5 hover:border-accent hover:text-accent transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <RefreshCw className={cn("w-3.5 h-3.5", busy && "animate-spin")} />
      Segarkan
    </button>
  );
}

/* ------------------------------------------------------------------ pembantu state */

/** Salinan `map` tanpa kunci `id` (objek yang sama bila kuncinya memang tidak ada). */
export function without<V>(map: Record<string, V>, id: string): Record<string, V> {
  if (!(id in map)) return map;
  const { [id]: gone, ...rest } = map;
  void gone;
  return rest;
}

export interface Notice {
  tone: "success" | "danger" | "info";
  text: string;
}

const NOTICE_MS = 7000;

/** Pemberitahuan singkat di atas daftar; hilang sendiri, dan tidak ikut kembali saat tab dibuka lagi. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Tab atau halaman yang disembunyikan (Activity) tidak boleh kembali dengan pemberitahuan basi.
  useLayoutEffect(
    () => () => {
      clearTimeout(timer.current);
      setNotice(null);
    },
    []
  );

  const show = useCallback((tone: Notice["tone"], text: string) => {
    setNotice({ tone, text });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setNotice(null);
  }, []);

  return { notice, show, clear };
}

/* ------------------------------------------------------------------ kartu keadaan */

function StateCard({
  icon,
  iconClass,
  title,
  children,
  action,
  alert,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div role={alert ? "alert" : undefined} className="card px-5 py-9 text-center">
      <div className={cn("mx-auto w-12 h-12 rounded-xl flex items-center justify-center", iconClass)}>{icon}</div>
      <p className="mt-4 text-sm font-bold text-fg">{title}</p>
      {children && <div className="mt-1 text-sm text-muted leading-relaxed max-w-md mx-auto space-y-1.5 break-words">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const CODE_CLS = "px-1.5 py-0.5 rounded-md bg-subtle text-fg text-[13px] font-semibold break-all";

/** Daftar kosong: jelaskan apa yang nanti mengisinya. */
export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <StateCard icon={icon} iconClass="bg-accent-soft text-accent" title={title}>
      {children}
    </StateCard>
  );
}

/** Skema radar belum dibuat di database (API membalas `installed: false`). */
export function NotInstalled() {
  return (
    <StateCard icon={<Database className="w-6 h-6" />} iconClass="bg-warning-soft text-warning" title="Radar belum dipasang.">
      <p>
        Pemilik dashboard perlu menjalankan <code className={CODE_CLS}>sql/006_autopilot_radar.sql</code> di Supabase.
      </p>
    </StateCard>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" onClick={onRetry} className={cn(BTN, BTN_PRIMARY, "px-5")}>
      <RotateCw className="w-4 h-4" />
      Coba lagi
    </button>
  );
}

/**
 * Daftar gagal dimuat dan belum ada data untuk ditampilkan. Status 503 (skema belum siap), 403 (peran
 * tidak cukup), dan 409 (workspace belum bisa ditentukan) diberi penjelasan sendiri; pesan aslinya
 * dari server tetap ditampilkan.
 */
export function LoadFailure({ status, message, onRetry }: { status: number | null; message: string; onRetry: () => void }) {
  const retry = <RetryButton onRetry={onRetry} />;
  if (status === 503) {
    return (
      <StateCard
        alert
        icon={<Database className="w-6 h-6" />}
        iconClass="bg-warning-soft text-warning"
        title="Radar belum siap."
        action={retry}
      >
        {/* Pesan server sudah menyebut berkas SQL yang perlu dijalankan. */}
        <p>{message}</p>
      </StateCard>
    );
  }
  if (status === 403) {
    return (
      <StateCard
        alert
        icon={<Lock className="w-6 h-6" />}
        iconClass="bg-warning-soft text-warning"
        title="Anda tidak punya izin membuka bagian ini."
        action={retry}
      >
        <p>{message}</p>
        <p>Minta Pemilik atau Admin workspace memeriksa peran Anda.</p>
      </StateCard>
    );
  }
  if (status === 409) {
    return (
      <StateCard
        alert
        icon={<Building2 className="w-6 h-6" />}
        iconClass="bg-warning-soft text-warning"
        title="Workspace belum bisa ditentukan."
        action={retry}
      >
        <p>{message}</p>
      </StateCard>
    );
  }
  return (
    <StateCard
      alert
      icon={<AlertTriangle className="w-6 h-6" />}
      iconClass="bg-danger-soft text-danger"
      title={message}
      action={retry}
    />
  );
}

/* ------------------------------------------------------------------ sumber sinyal */

const SOURCE_STYLE: Record<SignalSource, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  // Warna merek Threads (hitam/putih), supaya jelas datanya dari Threads.
  THREADS_SEARCH: { cls: "bg-black text-white dark:bg-white dark:text-black", Icon: ThreadsMark },
  GTRENDS: { cls: "bg-accent-soft text-accent", Icon: TrendingUp },
  JARINGAN: { cls: "bg-danger-soft text-danger", Icon: Flame },
  WEB: { cls: "bg-accent-soft text-accent", Icon: Globe },
  MOMEN: { cls: "bg-warning-soft text-warning", Icon: CalendarDays },
  MANUAL: { cls: "bg-subtle text-muted", Icon: Lightbulb },
};

export function SourceChip({ source, className }: { source: SignalSource; className?: string }) {
  // Sumber yang belum dikenal klien (ditambah di server kemudian) tetap tampil dengan gaya netral.
  const { cls, Icon } = SOURCE_STYLE[source] ?? SOURCE_STYLE.MANUAL;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0",
        cls,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {SIGNAL_SOURCE_LABEL[source] ?? source}
    </span>
  );
}
