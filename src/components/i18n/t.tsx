"use client";

import { useEffect } from "react";
import type { Vars } from "@/lib/i18n/core";
import { useLang, useT } from "./lang-provider";

/**
 * Teks terjemahan untuk Server Component yang tetap di-prerender statis: `<T>Cara kerja</T>`.
 * HTML awal berisi teks Indonesia (kunci); setelah hidrasi, pengguna EN melihat terjemahannya.
 */
export function T({ children, vars }: { children: string; vars?: Vars }) {
  return useT()(children, vars);
}

/**
 * Judul tab mengikuti bahasa di halaman statis (metadata server tetap bahasa Indonesia supaya halaman
 * bisa di-prerender). `title` = judul Indonesia persis seperti di `metadata.title`; `en` mengganti
 * hasil terjemahan kamus bila judul EN-nya berasal dari sumber lain.
 */
export function DocTitle({ title, en }: { title: string; en?: string }) {
  const { lang, t } = useLang();
  const next = lang === "en" ? (en ?? t(title)) : title;
  useEffect(() => {
    if (document.title !== next) document.title = next;
  }, [next]);
  return null;
}
