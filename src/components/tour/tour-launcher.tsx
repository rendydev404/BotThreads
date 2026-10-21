"use client";

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/layout/use-me";
import { TOUR_EVENT } from "./tour-events";

/** Kode tur (maskot, spotlight, langkah) diunduh hanya saat tur benar-benar dibuka. */
const Tour = lazy(() => import("./tour"));

const KEY = (userId: string) => `bt-tour-v1:${userId}`;
/** Jeda sebelum tur otomatis muncul, supaya halaman pertama sempat termuat dan terlihat dulu. */
const AUTO_DELAY_MS = 1500;

/**
 * Tur pengenalan: muncul otomatis sekali untuk tiap pengguna saat pertama masuk (dicatat per pengguna di
 * browser), dan bisa diputar ulang kapan saja dari menu profil.
 */
export function TourLauncher() {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const userId = me?.user.id ?? null;
  const ready = !!me?.hasAccess;

  useEffect(() => {
    if (!userId || !ready) return;
    let seen: string | null = "1";
    try {
      seen = localStorage.getItem(KEY(userId));
    } catch {
      /* penyimpanan diblokir: jangan memaksa tur */
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), AUTO_DELAY_MS);
    return () => clearTimeout(t);
  }, [userId, ready]);

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(TOUR_EVENT, on);
    return () => window.removeEventListener(TOUR_EVENT, on);
  }, []);

  const close = useCallback(
    (finished: boolean) => {
      setOpen(false);
      if (!userId) return;
      try {
        localStorage.setItem(KEY(userId), finished ? "selesai" : "dilewati");
      } catch {
        /* abaikan */
      }
    },
    [userId]
  );

  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <Tour onClose={close} hasAccounts={(me?.accountCount ?? 0) > 0} />
    </Suspense>
  );
}
