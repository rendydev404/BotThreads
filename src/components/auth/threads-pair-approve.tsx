"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Monitor, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { decideThreadsPair, peekThreadsPair } from "@/lib/threads-pair-client";
import type { PairingStatus } from "@/lib/threads-pairing";
import { AUTH_BUTTON_CLS, AuthFrame, AuthNotice, AuthSkeleton } from "./auth-frame";

type View =
  | { kind: "memuat" }
  | { kind: "galat"; message: string }
  | { kind: "lihat"; status: PairingStatus; workspaceName: string }
  | { kind: "disetujui" }
  | { kind: "ditolak" };

const DECIDED: Record<Exclude<PairingStatus, "menunggu">, string> = {
  disetujui: "QR ini sudah disetujui. Lanjutkan di komputer.",
  ditolak: "QR ini sudah ditolak. Buat QR baru di komputer bila ingin mencoba lagi.",
  dipakai: "QR ini sudah dipakai. Buat QR baru di komputer untuk menghubungkan akun lain.",
};

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** HP yang men-scan QR dari halaman /hubungkan di komputer: Pemilik/Admin menyetujui atau menolak. */
export function ThreadsPairApprove({ id }: { id: string }) {
  const [view, setView] = useState<View>({ kind: "memuat" });
  const [busy, setBusy] = useState<"setujui" | "tolak" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await peekThreadsPair(id);
        if (!cancelled) setView({ kind: "lihat", status: r.status, workspaceName: r.workspaceName });
      } catch (e) {
        if (!cancelled) setView({ kind: "galat", message: errText(e, "QR tidak bisa dibuka.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const decide = async (action: "setujui" | "tolak") => {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      await decideThreadsPair(id, action);
      setView({ kind: action === "setujui" ? "disetujui" : "ditolak" });
    } catch (e) {
      setError(errText(e, "Gagal menyimpan keputusan. Coba lagi."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthFrame title="Hubungkan dari komputer" subtitle="Persetujuan untuk QR yang Anda scan.">
      {view.kind === "memuat" && <AuthSkeleton label="Memuat permintaan" />}

      {view.kind === "galat" && (
        <AuthNotice tone="danger" icon={<AlertTriangle className="w-6 h-6" />} title="QR tidak bisa dipakai" href="/akun" action="Ke halaman Akun Threads">
          {view.message}
        </AuthNotice>
      )}

      {view.kind === "lihat" && view.status !== "menunggu" && (
        <AuthNotice tone="danger" icon={<AlertTriangle className="w-6 h-6" />} title="QR sudah diputuskan" href="/akun" action="Ke halaman Akun Threads">
          {DECIDED[view.status]}
        </AuthNotice>
      )}

      {view.kind === "lihat" && view.status === "menunggu" && (
        <div>
          <div className="w-12 h-12 mx-auto rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
            <Monitor className="w-6 h-6" />
          </div>
          <h2 className="mt-4 text-base font-bold text-fg text-center">Hubungkan akun Threads lewat komputer?</h2>
          <p className="mt-1.5 text-sm text-muted leading-relaxed text-center">
            Komputer yang menampilkan QR ini akan diarahkan ke halaman izin Threads. Akun Threads yang login di sana akan
            ditambahkan ke workspace <b className="text-fg">{view.workspaceName}</b>.
          </p>
          <p className="mt-3 rounded-lg bg-warning-soft text-fg text-xs leading-relaxed p-3">
            Setujui hanya bila QR ini tampil di komputer Anda sendiri. Jangan setujui QR yang dikirim orang lain.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger text-center">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void decide("setujui")}
            disabled={busy !== null}
            className={cn(AUTH_BUTTON_CLS, "mt-5 bg-accent hover:bg-accent-hover text-on-accent")}
          >
            {busy === "setujui" ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <CheckCircle2 className="w-[18px] h-[18px]" />}
            Setujui
          </button>
          <button
            type="button"
            onClick={() => void decide("tolak")}
            disabled={busy !== null}
            className={cn(AUTH_BUTTON_CLS, "mt-2.5 border border-line-strong text-fg hover:bg-subtle")}
          >
            {busy === "tolak" ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <XCircle className="w-[18px] h-[18px]" />}
            Tolak
          </button>
        </div>
      )}

      {view.kind === "disetujui" && (
        <AuthNotice tone="success" icon={<CheckCircle2 className="w-6 h-6" />} title="Disetujui" href="/akun" action="Ke halaman Akun Threads">
          Lanjutkan di komputer: klik <b>Lanjutkan ke Threads</b>, masuk ke akun Threads, lalu tekan <b>Izinkan</b>. Setelah itu akun
          muncul di halaman Akun Threads.
        </AuthNotice>
      )}

      {view.kind === "ditolak" && (
        <AuthNotice tone="danger" icon={<XCircle className="w-6 h-6" />} title="Ditolak" href="/akun" action="Ke halaman Akun Threads">
          Permintaan dari komputer ditolak. Tidak ada akun yang dihubungkan.
        </AuthNotice>
      )}
    </AuthFrame>
  );
}
