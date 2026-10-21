"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAutopilotOverview } from "@/lib/autopilot-client";
import type { AutopilotOverviewResponse } from "@/lib/autopilot-types";

const POLL_MS = 30_000;
/** Selama AI sedang menulis slot (MENULIS), data diperbarui lebih rapat supaya hasilnya cepat terlihat. */
const LIVE_POLL_MS = 5_000;
/** Kembali ke tab dalam selang ini tidak memicu fetch baru (data masih segar). */
const FRESH_MS = 5_000;

interface OverviewState {
  data: AutopilotOverviewResponse | null;
  error: string | null;
  /** Epoch ms saat data terakhir diterima; dipakai sebagai "sekarang" tanpa Date.now() saat render. */
  loadedAt: number | null;
}

/**
 * Ringkasan autopilot: satu fetch saat tampil, lalu polling 30 detik HANYA selama tab terlihat
 * (timer dihentikan saat tab disembunyikan, fetch ulang saat terlihat lagi). Permintaan yang masih
 * berjalan dibatalkan saat halaman ditinggalkan. Respons yang isinya sama tidak mengganti objek
 * data, jadi komponen turunan yang dimemo tidak ikut render ulang tiap polling.
 */
export function useAutopilotOverview() {
  const [state, setState] = useState<OverviewState>({ data: null, error: null, loadedAt: null });
  const ctrlRef = useRef<AbortController | null>(null);
  const jsonRef = useRef("");
  const lastOkRef = useRef(0);

  const refetch = useCallback((): Promise<void> => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    return fetchAutopilotOverview(ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return;
        const json = JSON.stringify(res);
        const same = json === jsonRef.current;
        jsonRef.current = json;
        const now = Date.now();
        lastOkRef.current = now;
        setState((prev) => ({ data: same && prev.data ? prev.data : res, error: null, loadedAt: now }));
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "Gagal memuat data autopilot." }));
      })
      .finally(() => {
        if (ctrlRef.current === ctrl) ctrlRef.current = null;
      });
  }, []);

  /** Ubah data lokal setelah mutasi kecil (tanpa fetch ulang); polling berikutnya menyelaraskan lagi. */
  const patch = useCallback((fn: (data: AutopilotOverviewResponse) => AutopilotOverviewResponse) => {
    jsonRef.current = "";
    setState((prev) => (prev.data ? { ...prev, data: fn(prev.data) } : prev));
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      // Polling melewati putaran bila permintaan sebelumnya belum selesai (tidak menumpuk).
      timer = setInterval(() => {
        if (!ctrlRef.current) void refetch();
      }, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      if (!ctrlRef.current && Date.now() - lastOkRef.current > FRESH_MS) void refetch();
      start();
    };

    void refetch();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      ctrlRef.current?.abort();
      ctrlRef.current = null;
    };
  }, [refetch]);

  // Hanya selama ada slot yang sedang ditulis dan tab terlihat; berhenti sendiri begitu penulisan selesai.
  const writing = state.data?.slots.some((s) => s.status === "MENULIS") ?? false;
  useEffect(() => {
    if (!writing) return;
    const t = setTimeout(() => {
      if (!ctrlRef.current && document.visibilityState === "visible") void refetch();
    }, LIVE_POLL_MS);
    return () => clearTimeout(t);
  }, [writing, state.loadedAt, refetch]);

  return { ...state, refetch, patch };
}
