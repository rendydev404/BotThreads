"use client";

import { useSyncExternalStore } from "react";

/**
 * Keadaan kecil yang dibagi bagian pembuka: kolom "coba untuk bisnis Anda" (kolom kiri), papan jadwal
 * (kolom kanan), dan cap status yang melayang di atas papan. Tanpa context/provider supaya halaman
 * tetap dirender server; hanya komponen yang membaca nilai yang berubah yang ikut dirender ulang.
 */
export interface HeroState {
  /** Kunci contoh brand, atau "custom" bila pengunjung mengetik bisnisnya sendiri. */
  key: string;
  /** Teks yang diketik pengunjung (dipakai bila key = "custom"). */
  custom: string;
  /** Tahap slot yang sedang dikerjakan papan, untuk cap status. */
  phase: string;
  /** Jam tayang slot itu, mis. "12.12". */
  time: string;
  /** Jumlah slot hari ini. */
  slots: number;
}

const INITIAL: HeroState = { key: "kuliner", custom: "", phase: "Direncanakan", time: "", slots: 3 };
let state = INITIAL;
const subs = new Set<() => void>();

export const heroStore = {
  get: () => state,
  set(patch: Partial<HeroState>) {
    const keys = Object.keys(patch) as (keyof HeroState)[];
    if (keys.every((k) => state[k] === patch[k])) return;
    state = { ...state, ...patch };
    subs.forEach((fn) => fn());
  },
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  },
};

/** Baca satu nilai dari store; pemilih harus mengembalikan nilai primitif. */
export function useHero<T extends string | number>(select: (s: HeroState) => T): T {
  return useSyncExternalStore(
    heroStore.subscribe,
    () => select(state),
    () => select(INITIAL)
  );
}
