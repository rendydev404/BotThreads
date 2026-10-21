"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Lightbulb, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { fetchOnboarding, runOnboardingAgent, type OnboardingDTO, type OnboardStepKey, type OnboardStepStatus } from "@/lib/ai-client";
import { cn } from "@/lib/utils";
import { AgentSteps, type AgentStepStatus } from "./agent-ui";

const LABELS: Record<OnboardStepKey, string> = {
  baca: "Membaca postingan & metrik akun",
  kenali: "Mengenali peran dan gaya akun",
  riset: "Mencari tren viral di niche akun",
  ide: "Menyusun ide postingan pertama",
  tulis: "Menulis postingan pertama hari ini",
};

const STATUS: Record<OnboardStepStatus, AgentStepStatus> = {
  MENUNGGU: "pending",
  BERJALAN: "active",
  SELESAI: "done",
  DILEWATI: "skipped",
  GAGAL: "failed",
};

/** Panel hasil ditampilkan sampai sehari setelah agen selesai, kecuali ditutup pengguna. */
const SHOW_DONE_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 2500;
/** Setelah menghubungkan akun, tunggu baris agen muncul selama ini walau belum ada yang berjalan. */
const EXPECT_MS = 20_000;
const DISMISS_KEY = "bt-onboarding-dismissed";

interface AccountLite {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Panel agen AI yang langsung bekerja saat akun Threads dihubungkan: langkah berjalan diperbarui langsung
 * (polling ringan hanya selama agen bekerja dan tab terlihat), hasilnya berupa tren dan ide yang siap dipakai.
 */
export function OnboardingPanel({
  accounts,
  expectSignal,
  canRun,
  onOpenProfile,
}: {
  accounts: AccountLite[];
  /** Berubah setiap kali akun baru dihubungkan: panel mulai memantau walau agen belum tercatat. */
  expectSignal: number;
  canRun: boolean;
  onOpenProfile: (accountId: string) => void;
}) {
  const [items, setItems] = useState<OnboardingDTO[]>([]);
  /** Waktu data terakhir diterima: dipakai sebagai "sekarang" tanpa Date.now() saat render. */
  const [loadedAt, setLoadedAt] = useState(0);
  // Panel baru dirender setelah data dimuat di peramban, jadi aman membaca localStorage saat inisialisasi.
  const [dismissed, setDismissed] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readDismissed()));
  const [rerun, setRerun] = useState<string | null>(null);
  const expectUntil = useRef(0);
  const lastSignal = useRef(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(
    (signal?: AbortSignal): Promise<void> =>
      fetchOnboarding(signal)
        .then((res) => {
          setItems((prev) => (JSON.stringify(prev) === JSON.stringify(res.items) ? prev : res.items));
          setLoadedAt(Date.now());
        })
        // Panel tambahan: galat tidak perlu mengganggu halaman.
        .catch(() => undefined),
    []
  );

  const running = items.some((i) => i.status === "BERJALAN");
  useEffect(() => {
    if (expectSignal !== lastSignal.current) {
      lastSignal.current = expectSignal;
      if (expectSignal > 0) expectUntil.current = Date.now() + EXPECT_MS;
    }
    const ctrl = new AbortController();
    void load(ctrl.signal);
    if (!running && Date.now() > expectUntil.current) return () => ctrl.abort();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load(ctrl.signal);
    }, POLL_MS);
    return () => {
      clearInterval(t);
      ctrl.abort();
    };
  }, [load, running, tick, expectSignal]);

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const visible = items.filter((i) => {
    const acc = byId.get(i.accountId);
    if (!acc) return false;
    if (i.status === "BERJALAN") return true;
    const doneAt = new Date(i.finishedAt ?? i.startedAt).getTime();
    return loadedAt - doneAt < SHOW_DONE_MS && !dismissed.has(`${i.accountId}:${i.startedAt}`);
  });
  if (!visible.length) return null;

  const dismiss = (i: OnboardingDTO) => {
    const next = new Set(dismissed).add(`${i.accountId}:${i.startedAt}`);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...next].slice(-50)));
    } catch {
      /* penyimpanan peramban tidak tersedia */
    }
  };

  const runAgain = async (accountId: string) => {
    setRerun(accountId);
    try {
      await runOnboardingAgent(accountId);
      expectUntil.current = Date.now() + EXPECT_MS;
      setTick((t) => t + 1);
    } catch {
      /* tombol akan aktif lagi; galat sementara */
    } finally {
      setRerun(null);
    }
  };

  return (
    <div className="space-y-3">
      {visible.map((i) => {
        const acc = byId.get(i.accountId)!;
        const live = i.status === "BERJALAN";
        const done = i.steps.filter((s) => s.status !== "MENUNGGU" && s.status !== "BERJALAN").length;
        const pct = Math.round((done / Math.max(1, i.steps.length)) * 100);
        const ideaStep = i.steps.find((s) => s.key === "ide");
        return (
          <section key={i.accountId} className={cn("ai-aura card p-4 sm:p-5", !live && "ai-aura-idle")} aria-live="polite">
            <header className="flex items-start gap-3">
              <div className="relative shrink-0">
                <AccountAvatar name={acc.displayName} src={acc.avatarUrl} size="w-11 h-11" className="text-sm" />
                <span
                  className={cn(
                    "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface text-white",
                    live ? "bg-accent" : i.status === "SELESAI" ? "bg-success" : "bg-warning"
                  )}
                >
                  <Bot className={cn("h-3 w-3", live && "animate-pulse")} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-fg">
                  {live ? (
                    <span className="ai-shimmer-text">Agen AI sedang mempelajari @{acc.username}</span>
                  ) : i.status === "SELESAI" ? (
                    `Agen AI selesai mempelajari @${acc.username}`
                  ) : (
                    `Agen AI belum selesai mempelajari @${acc.username}`
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {live
                    ? "Membaca postingan, mengenali peran akun, mencari tren niche, lalu menyiapkan draf pertama hari ini."
                    : "Tren, ide, dan draf pertama sudah disiapkan untuk akun ini."}
                </p>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-700", live ? "bg-accent" : "bg-success")}
                    style={{ width: `${Math.max(live ? 8 : 0, pct)}%` }}
                  />
                </div>
              </div>
              {!live && (
                <button
                  type="button"
                  onClick={() => dismiss(i)}
                  aria-label="Tutup panel agen"
                  className="rounded-lg p-1 text-muted hover:bg-subtle hover:text-fg cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </header>

            <div className="mt-4">
              <AgentSteps
                steps={i.steps.map((s) => ({
                  key: s.key,
                  label: LABELS[s.key] ?? s.key,
                  status: STATUS[s.status],
                  detail: s.detail,
                  items: s.items,
                }))}
              />
            </div>

            {!live && (
              <div className="msg-in mt-4 flex flex-wrap items-center gap-2">
                {ideaStep?.status === "SELESAI" && (
                  <Link
                    href="/radar?tab=ide"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover"
                  >
                    <Lightbulb className="h-3.5 w-3.5" /> Lihat ide <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => onOpenProfile(i.accountId)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-4 text-xs font-semibold text-fg hover:border-accent hover:text-accent cursor-pointer"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Atur Profil AI
                </button>
                {canRun && (
                  <button
                    type="button"
                    disabled={rerun === i.accountId}
                    onClick={() => void runAgain(i.accountId)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted hover:text-fg disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", rerun === i.accountId && "animate-spin")} /> Jalankan ulang
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
