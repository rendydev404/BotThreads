"use client";

/**
 * Komponen tampilan bersama konsol admin. Aturannya sederhana supaya semua modul terasa satu sistem:
 * - Satu "Panel" = satu kartu dengan judul singkat, keterangan satu baris, dan aksi di kanan.
 * - Angka dikelompokkan dalam satu panel (StatStrip), bukan kartu kecil terpisah yang sama berat.
 * - Warna hanya untuk status (berhasil/peringatan/bahaya); selain itu netral.
 */
import React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};
const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};
const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-faint",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

/** Angka uang di konsol: nol ditulis Rp0 (bukan "Gratis"), ribuan dengan titik. */
export const rupiah = (n: number): string => `Rp${Math.max(0, Math.round(n)).toLocaleString("id-ID")}`;

/** Tautan teks kecil di kanan judul panel, mis. "Kelola pengguna". */
export function PanelLink({ href, onClick, children }: { href?: string; onClick?: () => void; children: React.ReactNode }) {
  const cls = "inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:text-accent-hover whitespace-nowrap cursor-pointer";
  const body = (
    <>
      {children}
      <ArrowRight className="w-3.5 h-3.5" />
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} className={cn("card min-w-0 flex flex-col", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0 pt-0.5">{action}</div>}
        </header>
      )}
      <div className={cn("p-5 flex-1", (title || action) && "pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export interface StatItem {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
}

/** Deretan angka dalam satu panel, dipisah garis tipis. Dua kolom di ponsel. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  const cols = items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={cn("grid grid-cols-2 gap-y-4", cols, className)}>
      {items.map((s, i) => (
        <div key={s.label} className={cn("min-w-0 pr-3 lg:px-5 lg:first:pl-0", i > 0 && "lg:border-l lg:border-line")}>
          <dt className="text-xs text-muted truncate">{s.label}</dt>
          <dd className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight truncate", TONE_TEXT[s.tone ?? "neutral"])}>{s.value}</dd>
          {s.hint && <dd className="mt-0.5 text-xs text-faint truncate">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Kartu KPI utama di baris teratas ringkasan. */
export function KpiCard({
  label,
  value,
  hint,
  Icon,
  tone = "accent",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  Icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  return (
    <div className="card p-5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted truncate">{label}</p>
        <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", TONE_SOFT[tone])}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
      <p className="mt-3 text-[26px] leading-none font-semibold text-fg tabular-nums tracking-tight truncate">{value}</p>
      {hint && <p className="mt-2 text-xs text-muted truncate">{hint}</p>}
    </div>
  );
}

/** Persentase dengan bilah tipis. */
export function Meter({ label, pct, caption, tone = "accent" }: { label: string; pct: number; caption?: string; tone?: Tone }) {
  const safe = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-fg truncate">{label}</p>
        <p className={cn("text-sm font-semibold tabular-nums", TONE_TEXT[tone])}>{safe}%</p>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-subtle overflow-hidden" role="meter" aria-label={label} aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${safe}%` }} />
      </div>
      {caption && <p className="mt-1.5 text-xs text-muted">{caption}</p>}
    </div>
  );
}

export interface AttentionItem {
  key: string;
  tone: "warning" | "danger" | "info";
  title: string;
  detail?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

const ATTN_ICON = { warning: AlertTriangle, danger: XCircle, info: Info } as const;
const ATTN_CLS = { warning: "text-warning", danger: "text-danger", info: "text-accent" } as const;

/** Daftar hal yang butuh tindakan admin; kosong = satu baris "semua normal". */
export function AttentionList({ items, okText }: { items: AttentionItem[]; okText: string }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        {okText}
      </p>
    );
  }
  return (
    <ul className="-my-3 divide-y divide-line">
      {items.map((a) => {
        const Icon = ATTN_ICON[a.tone];
        return (
          <li key={a.key} className="py-3 flex items-start gap-3">
            <Icon className={cn("w-[18px] h-[18px] mt-0.5 shrink-0", ATTN_CLS[a.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{a.title}</p>
              {a.detail && <p className="mt-0.5 text-[13px] text-muted">{a.detail}</p>}
            </div>
            {a.action && (
              <div className="shrink-0 pt-0.5">
                <PanelLink href={a.action.href} onClick={a.action.onClick}>
                  {a.action.label}
                </PanelLink>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Titik status + teks, untuk baris status sistem. */
export function StatusDot({ tone }: { tone: Tone }) {
  return <span className={cn("inline-block w-2 h-2 rounded-full shrink-0", TONE_BAR[tone])} aria-hidden />;
}

/** Baris alat di atas daftar: kiri pencarian/filter, kanan tombol. */
export function Toolbar({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-2">{children}</div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
