"use client";

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Copy,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import type { PeriodValue } from "@/components/dashboard/period-filter";

interface Insight {
  text: string;
  model: string;
  degraded: boolean;
  generatedAt: string;
  periodLabel: string;
  scopeLabel: string;
}

export interface AiInsightPanelHandle {
  /** Jalankan analisis (dipakai tombol "Analisis AI" di toolbar) */
  run: () => void;
}

interface AiInsightPanelProps {
  account: string;
  period: PeriodValue;
  /** Teks pendek untuk label, mis. "7 hari terakhir" */
  periodLabel?: string;
  scopeLabel: string;
}

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));

export const AiInsightPanel = forwardRef<AiInsightPanelHandle, AiInsightPanelProps>(
  function AiInsightPanel({ account, period, periodLabel, scopeLabel }, ref) {
    const rootRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [entry, setEntry] = useState<{ key: string; insight: Insight } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    // Hasil hanya ditampilkan bila masih cocok dengan filter yang aktif
    const key = JSON.stringify([account, period.key, period.from ?? "", period.to ?? ""]);
    const current = entry && entry.key === key ? entry.insight : null;
    const stale = entry && entry.key !== key;
    const label = periodLabel ?? "periode ini";

    const analyze = async (force = false) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/analytics/insight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            account,
            period: period.key,
            from: period.from,
            to: period.to,
            force,
          }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Gagal");
        setEntry({ key, insight: json.insight });
        setLoading(false);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError("Analisis belum bisa dibuat. Periksa koneksi lalu coba lagi.");
        setLoading(false);
      }
    };

    useImperativeHandle(ref, () => ({
      run: () => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (!loading) void analyze(false);
      },
    }));

    const copy = async () => {
      if (!current) return;
      try {
        await navigator.clipboard.writeText(current.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        /* clipboard tidak tersedia */
      }
    };

    const followUp = `Lanjutkan analisis ${label} untuk ${scopeLabel}: dalami saran yang paling berdampak dan buatkan 3 draf postingan Threads-nya.`;

    return (
      <div
        ref={rootRef}
        className="mt-5 rounded-xl border border-accent/30 bg-accent-soft/50 overflow-hidden"
      >
        {/* Belum dianalisis */}
        {!current && !loading && (
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-accent text-on-accent flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  Analisis & saran dari AI
                </p>
                <p className="text-[13px] text-muted mt-0.5">
                  Temuan penting, langkah yang bisa dikerjakan, dan ide konten
                  berdasarkan data {label} · {scopeLabel}.
                </p>
                {stale && (
                  <p className="text-xs text-accent mt-1">
                    Filter berubah, analisis sebelumnya tidak ditampilkan.
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => analyze(false)}
              className="h-11 px-5 inline-flex items-center justify-center gap-2 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold cursor-pointer transition-colors shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              Analisis & beri saran
            </button>
          </div>
        )}

        {/* Menunggu AI */}
        {loading && (
          <div className="p-4 sm:p-5" aria-live="polite" aria-busy="true">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent text-on-accent flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <p className="text-sm font-semibold text-fg">
                  AI sedang menganalisis data {label}…
                </p>
                <p className="text-[13px] text-muted">Biasanya 10 sampai 25 detik.</p>
              </div>
            </div>
            <div className="mt-4 space-y-2.5 animate-pulse">
              <div className="h-3.5 w-11/12 rounded bg-line" />
              <div className="h-3.5 w-10/12 rounded bg-line" />
              <div className="h-3.5 w-9/12 rounded bg-line" />
              <div className="h-3.5 w-11/12 rounded bg-line" />
            </div>
          </div>
        )}

        {/* Gagal */}
        {error && !loading && (
          <div className="px-4 sm:px-5 pb-4 -mt-1">
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </p>
          </div>
        )}

        {/* Hasil */}
        {current && !loading && (
          <div>
            <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3 border-b border-accent/20">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-accent text-on-accent flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-sm font-semibold text-fg truncate">
                    Analisis & saran AI
                  </p>
                  <p className="text-xs text-muted truncate">
                    {current.scopeLabel} · {current.periodLabel} · {timeLabel(current.generatedAt)} WIB
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={copy}
                  title="Salin analisis"
                  aria-label="Salin analisis"
                  className="w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-surface flex items-center justify-center cursor-pointer transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => analyze(true)}
                  title="Buat ulang analisis"
                  aria-label="Buat ulang analisis"
                  className="w-9 h-9 rounded-lg text-muted hover:text-fg hover:bg-surface flex items-center justify-center cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-4 text-sm leading-relaxed text-fg">
              <Markdown text={current.text} />
            </div>

            <div className="px-4 sm:px-5 pb-4 flex flex-wrap items-center gap-2">
              <Link
                href={`/prompt-studio?prompt=${encodeURIComponent(followUp)}`}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Tanya lanjutan di chat
              </Link>
              {current.degraded && (
                <span className="text-xs text-muted">
                  AI sedang sibuk, ini analisis otomatis.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
