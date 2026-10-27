"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorStatus, errorText } from "./format";
import { useT } from "@/components/i18n/lang-provider";

/** Kembali ke tab dalam selang ini tidak memicu fetch ulang (data masih segar). */
const FRESH_MS = 20_000;

interface RemoteState<T> {
  key: string | null;
  tick: number;
  data: T | null;
  error: string | null;
  status: number | null;
  /** Epoch ms saat data diterima; dipakai sebagai "sekarang" tanpa Date.now() saat render. */
  loadedAt: number | null;
}

/**
 * Satu sumber data jarak jauh untuk sebuah tab. Fetch berjalan di effect, jadi tab yang masih
 * tersembunyi (Activity) tidak memuat apa pun sampai dibuka; permintaan yang masih berjalan dibatalkan
 * saat tab ditinggalkan atau kuncinya berubah. `key = null` menonaktifkan fetch.
 */
export function useRemote<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>, fallbackError: string) {
  // Pesan galat disimpan apa adanya lalu diterjemahkan saat dibaca, jadi ikut berganti bila bahasa diubah.
  const t = useT();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<RemoteState<T>>({ key: null, tick: 0, data: null, error: null, status: null, loadedAt: null });
  const fetcherRef = useRef(fetcher);
  const freshRef = useRef<{ key: string; tick: number; at: number } | null>(null);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    const fresh = freshRef.current;
    if (fresh && fresh.key === key && fresh.tick === tick && Date.now() - fresh.at < FRESH_MS) return;
    const ctrl = new AbortController();
    fetcherRef.current(ctrl.signal).then(
      (data) => {
        if (ctrl.signal.aborted) return;
        const now = Date.now();
        freshRef.current = { key, tick, at: now };
        setState({ key, tick, data, error: null, status: null, loadedAt: now });
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((prev) => ({
          key,
          tick,
          data: prev.key === key ? prev.data : null,
          error: errorText(e, fallbackError),
          status: errorStatus(e),
          loadedAt: prev.key === key ? prev.loadedAt : null,
        }));
      }
    );
    return () => ctrl.abort();
  }, [key, tick, fallbackError]);

  const current = key !== null && state.key === key;
  const data = current ? state.data : null;
  // Memuat pertama kali, atau mencoba lagi setelah gagal tanpa data.
  const loading = key !== null && (!current || (data === null && state.tick !== tick));
  const refreshing = !loading && current && state.tick !== tick;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /** Ubah data lokal setelah mutasi (tanpa fetch ulang). `forKey` menolak hasil untuk kunci yang sudah berganti. */
  const mutate = useCallback((fn: (data: T) => T, forKey?: string) => {
    setState((prev) => (prev.data !== null && (forKey === undefined || prev.key === forKey) ? { ...prev, data: fn(prev.data) } : prev));
  }, []);

  return {
    data,
    error: current && state.error ? t(state.error) : null,
    status: current ? state.status : null,
    loadedAt: current ? state.loadedAt : null,
    loading,
    refreshing,
    reload,
    mutate,
  };
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Daftar berhalaman di atas `useRemote`: halaman pertama dimuat saat tab dibuka, halaman berikutnya
 * lewat `loadMore` (kursor dari server). Baris yang sama tidak pernah tampil dua kali.
 */
export function usePaged<T, R extends Page<T>>(
  key: string | null,
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<R>,
  idOf: (item: T) => string,
  fallbackError: string
) {
  const t = useT();
  const remote = useRemote<R>(key, (signal) => fetchPage(null, signal), fallbackError);
  const [more, setMore] = useState<{ key: string | null; loading: boolean; error: string | null }>({ key: null, loading: false, error: null });
  const fetchRef = useRef(fetchPage);
  const idRef = useRef(idOf);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchRef.current = fetchPage;
    idRef.current = idOf;
  });

  // Tab ditinggalkan atau filter berganti: batalkan "Muat lagi" yang masih berjalan.
  useEffect(
    () => () => {
      ctrlRef.current?.abort();
      ctrlRef.current = null;
    },
    [key]
  );

  const { data, mutate } = remote;
  const cursor = data?.nextCursor ?? null;
  const moreNow = more.key === key ? more : { key, loading: false, error: null };

  const loadMore = useCallback(async () => {
    if (key === null || !cursor || ctrlRef.current) return;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setMore({ key, loading: true, error: null });
    // Selesai (berhasil, gagal, atau dibatalkan): lepas status memuat hanya bila masih untuk kunci ini.
    const settle = (error: string | null) => setMore((m) => (m.key === key ? { key, loading: false, error } : m));
    try {
      const res = await fetchRef.current(cursor, ctrl.signal);
      if (!ctrl.signal.aborted) {
        const id = idRef.current;
        mutate((prev) => {
          const seen = new Set(prev.items.map(id));
          return { ...prev, items: [...prev.items, ...res.items.filter((i) => !seen.has(id(i)))], nextCursor: res.nextCursor };
        }, key);
      }
      settle(null);
    } catch (e) {
      settle(ctrl.signal.aborted ? null : errorText(e, "Gagal memuat halaman berikutnya."));
    } finally {
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
    }
  }, [key, cursor, mutate]);

  return {
    ...remote,
    items: data?.items ?? [],
    nextCursor: cursor,
    loadMore,
    loadingMore: moreNow.loading,
    moreError: moreNow.error ? t(moreNow.error) : null,
  };
}
