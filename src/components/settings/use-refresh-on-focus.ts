"use client";

import { useEffect, useRef } from "react";

/**
 * Muat ulang data saat pengguna kembali ke tab/jendela (stale-while-revalidate, seperti refetchOnWindowFocus),
 * tanpa polling: tidak ada timer, tidak ada request saat tab tersembunyi, dan paling sering sekali per
 * `minGapMs`. Data lama tetap tampil selama muat ulang (tidak ada skeleton, posisi scroll tidak berubah).
 * `enabled = false` melepas pendengar sama sekali.
 */
export function useRefreshOnFocus(reload: () => void, enabled: boolean, minGapMs = 30_000) {
  const reloadRef = useRef(reload);
  const lastRef = useRef(0);

  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    if (!enabled) return;
    lastRef.current = Date.now();
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRef.current < minGapMs) return;
      lastRef.current = now;
      reloadRef.current();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [enabled, minGapMs]);
}
