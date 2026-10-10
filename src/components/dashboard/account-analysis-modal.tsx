"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  X,
  Copy,
  Check,
  ArrowRight,
  TrendingUp,
  BarChart2,
  FileText,
  RotateCw,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface AccountAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: string; // 'all' or username
  accountLabel: string;
}

export function AccountAnalysisModal({
  isOpen,
  onClose,
  account,
  accountLabel,
}: AccountAnalysisModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const fetchAnalysis = async () => {
    setLoading(true);
    setReport(null);
    try {
      const res = await fetch("/api/analytics/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account }),
      });
      const data = await res.json();
      if (data.success) {
        setReport(data.analysisReport);
        setMetrics(data.metrics);
      } else {
        setReport("Gagal memuat analisis: " + (data.error || "Terjadi kesalahan"));
      }
    } catch (err: any) {
      setReport("Koneksi gagal saat menghubungi Hermes AI: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchAnalysis();
    }
  }, [isOpen, account]);

  const handleCopy = () => {
    if (report) {
      navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenStudio = () => {
    const promptQuery = encodeURIComponent(
      `Tolong buatkan 3 draf konten lanjutan berdasarkan hasil analisis untuk ${accountLabel}: ${report?.slice(0, 150)}`
    );
    router.push(`/prompt-studio?prompt=${promptQuery}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#343C6A]/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl border border-[#EDF2F7] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#EDF2F7] bg-[#F8FAFC]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-[#343C6A]">
                  Audit Performa Hermes AI
                </h3>
                <span className="text-[10px] font-bold text-[#1814F3] bg-[#1814F3]/10 px-2 py-0.5 rounded-full">
                  Live DB
                </span>
              </div>
              <p className="text-xs text-[#718EBF] truncate max-w-sm sm:max-w-md">
                {accountLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-[#EDF2F7] hover:bg-[#F4F7FE] text-[#718EBF] hover:text-[#343C6A] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Quick Metrics Pills */}
          {metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
                <span className="text-[10px] uppercase font-semibold text-[#718EBF] block">
                  Total Views
                </span>
                <span className="text-sm font-bold text-[#343C6A]">
                  {formatNumber(metrics.totalViews)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
                <span className="text-[10px] uppercase font-semibold text-[#718EBF] block">
                  Postingan
                </span>
                <span className="text-sm font-bold text-[#343C6A]">
                  {metrics.totalPosts}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
                <span className="text-[10px] uppercase font-semibold text-[#718EBF] block">
                  Interaksi
                </span>
                <span className="text-sm font-bold text-[#343C6A]">
                  {formatNumber(metrics.totalInteractions)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7] text-center">
                <span className="text-[10px] uppercase font-semibold text-[#718EBF] block">
                  Engagement Rate
                </span>
                <span className="text-sm font-bold text-[#10B981]">
                  {metrics.er}%
                </span>
              </div>
            </div>
          )}

          {/* Analysis Content or Loading */}
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <RotateCw className="w-8 h-8 text-[#1814F3] animate-spin" />
              <p className="text-sm font-bold text-[#343C6A]">
                Hermes AI sedang mengolah performa akun...
              </p>
              <p className="text-xs text-[#718EBF] max-w-sm">
                Menganalisis rasio impresi, tren engagement, dan formula konten dari database Supabase.
              </p>
            </div>
          ) : report ? (
            <div className="p-5 rounded-2xl bg-[#F8FAFC] border border-[#EDF2F7]">
              <div className="whitespace-pre-line text-xs sm:text-sm text-[#343C6A] leading-relaxed font-normal space-y-2">
                {report}
              </div>
            </div>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-[#EDF2F7] bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={fetchAnalysis}
            disabled={loading}
            className="text-xs font-semibold text-[#718EBF] hover:text-[#1814F3] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Perbarui Audit
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!report || loading}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full border border-[#EDF2F7] text-xs font-semibold text-[#343C6A] hover:bg-[#F4F7FE] cursor-pointer transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#718EBF]" />
                  <span>Salin Hasil</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenStudio}
              disabled={!report || loading}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-full bg-[#1814F3] hover:bg-[#120ec0] text-white text-xs font-bold shadow-sm cursor-pointer transition-colors"
            >
              <span>Buka di Studio</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
