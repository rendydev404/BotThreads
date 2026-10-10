"use client";

import React, { useRef, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import type { Delta, Report } from "@/lib/report";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function shortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** 70.300 -> "70,3 rb", 1.250.000 -> "1,3 jt" */
function compact(n: number) {
  const f = (v: number, unit: string) =>
    `${(Math.round(v * 10) / 10).toString().replace(".", ",")} ${unit}`;
  if (n >= 1_000_000) return f(n / 1_000_000, "jt");
  if (n >= 10_000) return f(n / 1000, "rb");
  return n.toLocaleString("id-ID");
}

function DeltaBadge({ delta, className }: { delta: Delta; className?: string }) {
  if (delta === null) return null;
  if (delta === "new") {
    return (
      <span className={cn("text-xs font-medium text-accent", className)}>baru</span>
    );
  }
  const up = delta >= 0;
  return (
    <span
      className={cn(
        "text-xs font-semibold tabular-nums",
        up ? "text-success" : "text-danger",
        className
      )}
    >
      {up ? "▲" : "▼"}
      {Math.abs(delta)}%
    </span>
  );
}

interface ReportCardProps {
  report: Report;
  onPickAccount?: (username: string) => void;
}

const PERIODS = [7, 14, 30];

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 px-2.5 rounded-full text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap",
        active
          ? "bg-accent-soft text-accent border-accent/40"
          : "bg-surface text-muted border-line hover:text-fg hover:border-line-strong"
      )}
    >
      {children}
    </button>
  );
}

export function ReportCard({ report: initial, onPickAccount }: ReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Hasil dari klik filter menimpa laporan awal; kartu berubah di tempat, bukan pesan baru
  const [override, setOverride] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const report = override ?? initial;
  const { totals, ranking } = report;

  const reload = async (days: number, scope: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(
        `/api/analytics/report?days=${days}&scope=${encodeURIComponent(scope)}`,
        { signal: ctrl.signal }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setOverride(json.report);
      setExpanded(false);
      setBusy(false);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setFailed(true);
      setBusy(false);
    }
  };

  const changed = override !== null && (override.days !== initial.days || override.scope.slug !== initial.scope.slug);
  const shown = expanded ? ranking : ranking.slice(0, 10);
  const maxViews = Math.max(ranking[0]?.views ?? 1, 1);

  const kpis = [
    { label: "Views", value: compact(totals.views), delta: totals.viewsDelta },
    { label: "ER", value: `${String(totals.er).replace(".", ",")}%` },
    { label: "Postingan", value: totals.posts.toLocaleString("id-ID") },
    ...(totals.followers !== null
      ? [
          {
            label: "Followers",
            value: totals.followers.toLocaleString("id-ID"),
            note:
              totals.followersDelta !== null
                ? `${totals.followersDelta >= 0 ? "+" : ""}${totals.followersDelta}`
                : undefined,
          },
        ]
      : []),
  ];

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-3 border-b border-line bg-subtle/60">
        <p className="text-sm font-semibold text-fg">
          {report.scope.label} · {report.days} hari
        </p>
        <p className="text-xs text-muted mt-0.5">
          {shortDate(report.from)} – {shortDate(report.to)}
          {report.hasPrev
            ? ` · dibanding ${report.days} hari sebelumnya`
            : " · belum ada data pembanding"}
        </p>
      </div>

      <div className="px-4 py-2.5 border-b border-line space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-xs text-muted w-14 shrink-0">Periode</span>
            {PERIODS.map((d) => (
              <Chip
                key={d}
                active={d === report.days}
                onClick={() => reload(d, report.scope.slug)}
              >
                {d} hari
              </Chip>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="text-xs text-muted w-14 shrink-0">Cakupan</span>
            {report.scopes.map((s) => (
              <Chip
                key={s.slug}
                active={s.slug === report.scope.slug}
                onClick={() => reload(report.days, s.slug)}
              >
                {s.slug === "all" ? s.label : `${s.label} (${s.accounts})`}
              </Chip>
            ))}
          </div>
          {failed && (
            <p role="alert" className="text-xs text-danger">
              Gagal memuat data. Coba klik lagi.
            </p>
          )}
          {changed && !busy && (
            <p className="text-xs text-muted">
              Catatan AI di bawah kartu ini dibuat untuk tampilan awal.
            </p>
          )}
        </div>

      <div
        aria-busy={busy}
        className={cn("grid grid-cols-2 sm:grid-cols-4 gap-px bg-line transition-opacity", busy && "opacity-50")}
      >
        {kpis.map((k) => (
          <div key={k.label} className="bg-surface px-4 py-3">
            <p className="text-xs text-muted">{k.label}</p>
            <p className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-bold text-fg tabular-nums">{k.value}</span>
              {"delta" in k && <DeltaBadge delta={k.delta ?? null} />}
              {"note" in k && k.note && (
                <span className="text-xs text-muted">({k.note})</span>
              )}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-sm font-semibold text-fg">
        <Trophy className="w-4 h-4 text-warning" />
        Peringkat views
        <span className="text-xs font-normal text-muted">
          · klik akun untuk dianalisis
        </span>
      </div>

      <ul className={cn("px-2 pb-2 transition-opacity", busy && "opacity-50")}>
        {shown.map((row, i) => (
          <li key={row.username}>
            <button
              type="button"
              onClick={() => onPickAccount?.(row.username)}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-subtle transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="w-5 text-xs text-muted tabular-nums shrink-0">
                  {i + 1}
                </span>
                <span className="font-medium text-fg truncate">@{row.username}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 pl-7">
                <div className="flex-1 h-1.5 rounded-full bg-subtle overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(2, (row.views / maxViews) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-fg tabular-nums w-14 text-right">
                  {compact(row.views)}
                </span>
                <DeltaBadge delta={row.delta} className="w-12" />
              </div>
              <p className="mt-0.5 pl-7 text-xs text-muted">
                {row.followers !== null && row.followers !== undefined && (
                  <span className="font-medium text-fg/80">{compact(row.followers)} fol · </span>
                )}
                ER {String(row.er).replace(".", ",")}% · {row.posts} post
              </p>
            </button>
          </li>
        ))}
      </ul>

      {ranking.length > 10 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-4 py-2.5 border-t border-line text-sm font-medium text-accent hover:bg-subtle inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          {expanded ? "Tampilkan 10 teratas" : `Lihat semua ${ranking.length} akun`}
          <ChevronDown className={cn("w-4 h-4 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
