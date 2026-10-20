"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { continueThreadsPair, createThreadsPair, pollThreadsPair, type PairPollStatus } from "@/lib/threads-pair-client";
import { AUTH_BUTTON_CLS, AuthFrame } from "./auth-frame";

const POLL_MS = 2500;
const PRIMARY = cn(AUTH_BUTTON_CLS, "bg-accent hover:bg-accent-hover text-on-accent");
const SECONDARY = cn(AUTH_BUTTON_CLS, "border border-line-strong text-fg hover:bg-subtle");

type Phase =
  | { kind: "memuat" }
  | { kind: "galat"; message: string }
  | { kind: "menunggu"; token: string; qrSvg: string; expiresAt: number }
  | { kind: "disetujui"; token: string; workspaceName: string; approverName: string }
  | { kind: "berakhir"; status: Exclude<PairPollStatus, "menunggu" | "disetujui"> };

const ENDED: Record<Extract<Phase, { kind: "berakhir" }>["status"], string> = {
  ditolak: "Permintaan ditolak dari HP. Buat QR baru bila ingin mencoba lagi.",
  kedaluwarsa: "QR sudah kedaluwarsa (berlaku 10 menit). Buat QR baru.",
  dipakai: "QR ini sudah dipakai. Buat QR baru untuk menghubungkan akun lain.",
};

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Komputer: tampilkan QR, tunggu persetujuan dari HP (polling ringan, berhenti saat tab tersembunyi), lalu minta
 * konfirmasi sebelum lanjut ke halaman izin Threads. Nama workspace & penyetuju ditampilkan supaya QR yang
 * disetujui orang lain tidak diam-diam menghubungkan akun Threads di komputer ini ke workspace mereka.
 */
export function ThreadsPairDesktop() {
  const [phase, setPhase] = useState<Phase>({ kind: "memuat" });
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Naik setiap "Buat QR baru": memicu pembuatan QR berikutnya.
  const [generation, setGeneration] = useState(0);

  const regenerate = () => {
    setError(null);
    setPhase({ kind: "memuat" });
    setGeneration((g) => g + 1);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await createThreadsPair();
        if (cancelled) return;
        setNow(Date.now());
        setPhase({ kind: "menunggu", token: r.pollToken, qrSvg: r.qrSvg, expiresAt: Date.parse(r.expiresAt) });
      } catch (e) {
        if (!cancelled) setPhase({ kind: "galat", message: errText(e, "QR gagal dibuat. Coba lagi.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation]);

  useEffect(() => {
    if (phase.kind !== "menunggu") return;
    const { token, expiresAt } = phase;
    let stopped = false;
    let timer: number | undefined;

    const schedule = () => {
      if (!stopped && timer === undefined) timer = window.setTimeout(tick, POLL_MS);
    };
    async function tick() {
      timer = undefined;
      // Tab tersembunyi: berhenti, dilanjutkan saat terlihat lagi.
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAt) {
        setPhase({ kind: "berakhir", status: "kedaluwarsa" });
        return;
      }
      try {
        const r = await pollThreadsPair(token);
        if (stopped) return;
        if (r.status === "menunggu") {
          setNow(Date.now());
          schedule();
        } else if (r.status === "disetujui") {
          setPhase({ kind: "disetujui", token, workspaceName: r.workspaceName ?? "workspace", approverName: r.approverName ?? "Admin" });
        } else {
          setPhase({ kind: "berakhir", status: r.status });
        }
      } catch {
        schedule(); // jaringan putus sesaat: coba lagi
      }
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = undefined;
      void tick();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase]);

  const proceed = async (token: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await continueThreadsPair(token);
      window.location.assign(r.url);
    } catch (e) {
      setError(errText(e, "Gagal melanjutkan ke Threads."));
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Hubungkan akun Threads" subtitle="Scan QR ini dengan HP yang sudah masuk dashboard BotThreads.">
      {phase.kind === "memuat" && (
        <div className="flex flex-col items-center gap-3 py-6" aria-busy="true">
          <div className="w-[220px] h-[220px] rounded-xl bg-subtle animate-pulse" />
          <p className="text-sm text-muted">Membuat QR...</p>
        </div>
      )}

      {phase.kind === "galat" && (
        <div className="text-center" role="alert">
          <AlertTriangle className="w-8 h-8 mx-auto text-danger" />
          <p className="mt-3 text-sm text-fg">{phase.message}</p>
          <button type="button" onClick={regenerate} className={cn(PRIMARY, "mt-5")}>
            <RefreshCw className="w-[18px] h-[18px]" />
            Coba lagi
          </button>
        </div>
      )}

      {phase.kind === "menunggu" && (
        <div>
          {/* SVG dibuat server kita sendiri dari alamat persetujuan (bukan masukan pengguna). */}
          <div
            className="mx-auto w-[220px] h-[220px] rounded-xl bg-white p-2 ring-1 ring-line [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: phase.qrSvg }}
          />
          <ol className="mt-5 space-y-2 text-sm text-fg list-decimal pl-5 leading-relaxed">
            <li>Buka kamera HP (atau Google Lens), arahkan ke QR ini, lalu ketuk link yang muncul.</li>
            <li>
              Di HP, tekan <b>Setujui</b> (perlu akun Pemilik atau Admin workspace).
            </li>
            <li>Kembali ke komputer ini, lalu lanjutkan ke Threads dan tekan Izinkan.</li>
          </ol>
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Menunggu persetujuan dari HP · berlaku {Math.max(1, Math.ceil((phase.expiresAt - now) / 60_000))} menit lagi
          </p>
          <p className="mt-4 text-xs text-muted text-center leading-relaxed">
            Opsional. Anda juga bisa{" "}
            <Link href="/akun" className="underline hover:text-fg">
              masuk dashboard di komputer ini
            </Link>{" "}
            lalu menekan Hubungkan Akun Threads seperti biasa.
          </p>
        </div>
      )}

      {phase.kind === "disetujui" && (
        <div className="text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-success-soft text-success flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h2 className="mt-4 text-base font-bold text-fg">Disetujui dari HP</h2>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            Akun Threads yang Anda masuki berikutnya akan dihubungkan ke workspace <b className="text-fg">{phase.workspaceName}</b>{" "}
            (disetujui oleh <b className="text-fg">{phase.approverName}</b>).
          </p>
          <p className="mt-2 text-xs text-muted leading-relaxed">
            Di halaman Threads, masuk dengan akun Threads yang ingin dihubungkan, lalu tekan Izinkan.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <button type="button" onClick={() => void proceed(phase.token)} disabled={busy} className={cn(PRIMARY, "mt-5")}>
            {busy ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <ArrowRight className="w-[18px] h-[18px]" />}
            Lanjutkan ke Threads
          </button>
          <button type="button" onClick={regenerate} disabled={busy} className={cn(SECONDARY, "mt-2.5")}>
            Bukan workspace Anda? Buat QR baru
          </button>
        </div>
      )}

      {phase.kind === "berakhir" && (
        <div className="text-center" role="status">
          <AlertTriangle className="w-8 h-8 mx-auto text-warning" />
          <p className="mt-3 text-sm text-fg">{ENDED[phase.status]}</p>
          <button type="button" onClick={regenerate} className={cn(PRIMARY, "mt-5")}>
            <RefreshCw className="w-[18px] h-[18px]" />
            Buat QR baru
          </button>
        </div>
      )}
    </AuthFrame>
  );
}
