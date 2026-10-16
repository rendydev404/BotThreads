"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const currentYear = () => new Date().getFullYear();
const prerenderYear = () => null;

/** Baca waktu setelah hidrasi agar footer aman diprerender di halaman publik. */
export function CopyrightYear() {
  return useSyncExternalStore(subscribe, currentYear, prerenderYear);
}
