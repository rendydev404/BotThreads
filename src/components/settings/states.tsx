"use client";

import React from "react";
import { AlertTriangle, Database, Lock, RefreshCw, RotateCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";

/* ------------------------------------------------------------------ kelas tombol bersama */

export const BTN_PRIMARY =
  "h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed";

export const BTN_OUTLINE =
  "h-10 px-4 rounded-full border border-line-strong text-[13px] font-semibold text-fg inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed";

/** Tombol ikon 40px (area sentuh penuh). */
export const ICON_BTN =
  "w-10 h-10 shrink-0 rounded-lg inline-flex items-center justify-center text-muted cursor-pointer transition-colors hover:text-fg hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed";

/* ------------------------------------------------------------------ chip */

export type PillTone = "accent" | "solid" | "success" | "warning" | "danger" | "neutral";

const PILL_CLASS: Record<PillTone, string> = {
  accent: "bg-accent-soft text-accent",
  solid: "bg-accent text-on-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-subtle text-muted",
};

export function Pill({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: PillTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap max-w-full",
        PILL_CLASS[tone],
        className
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ keadaan tab */

const ERROR_TITLE: Record<number, string> = {
  0: "Koneksi bermasalah.",
  401: "Sesi berakhir.",
  403: "Anda tidak punya akses ke bagian ini.",
  409: "Workspace belum bisa ditentukan.",
  503: "Bagian ini belum siap dipakai.",
};

/**
 * Tab gagal dimuat. 503 (skema belum dipasang atau server bermasalah), 409 (workspace belum jelas),
 * dan 403 tampil sebagai pemberitahuan tenang berisi pesan server; galat lain tampil sebagai galat.
 */
export function LoadError({ message, status, onRetry }: { message: string; status: number | null; onRetry: () => void }) {
  const t = useT();
  const calm = status === 503 || status === 409 || status === 403;
  const Icon = status === 503 ? Database : status === 403 ? Lock : status === 0 ? WifiOff : AlertTriangle;
  return (
    <div role="alert" className="card p-8 text-center">
      <div
        className={cn(
          "mx-auto w-12 h-12 rounded-xl flex items-center justify-center",
          calm ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger"
        )}
      >
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-base font-bold text-fg">{t((status !== null && ERROR_TITLE[status]) || "Gagal memuat data.")}</h3>
      <p className="mt-1 text-sm text-muted max-w-md mx-auto break-words">{t(message)}</p>
      <button type="button" onClick={onRetry} className={cn(BTN_PRIMARY, "mt-4")}>
        <RotateCw className="w-4 h-4" />
        {t("Coba lagi")}
      </button>
    </div>
  );
}

/** Balasan `installed: false`: tabel fiturnya belum dibuat di database. */
export function NotInstalled({ title, file }: { title: string; file: string }) {
  const t = useT();
  return (
    <div className="card p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-warning-soft text-warning flex items-center justify-center">
        <Database className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-base font-bold text-fg">{t(title)}</h3>
      <p className="mt-1 text-sm text-muted max-w-md mx-auto">
        {t("Pemilik dashboard perlu menjalankan")}{" "}
        <code className="px-1.5 py-0.5 rounded-md bg-subtle text-fg text-[13px] font-semibold break-all">{file}</code> {t("di Supabase.")}
      </p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto w-12 h-12 rounded-xl bg-accent-soft text-accent flex items-center justify-center">{icon}</div>
      <p className="mt-4 text-sm font-semibold text-fg">{t(title)}</p>
      {children && <p className="mt-1 text-sm text-muted max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function RefreshButton({ onClick, busy, disabled }: { onClick: () => void; busy: boolean; disabled?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} className={cn(BTN_OUTLINE, "shrink-0 px-3.5")}>
      <RefreshCw className={cn("w-3.5 h-3.5", busy && "animate-spin")} />
      {t("Segarkan")}
    </button>
  );
}
