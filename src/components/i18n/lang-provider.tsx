"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  loadEnDict,
  localeOf,
  makeT,
  setCurrentT,
  type Dict,
  type Lang,
  type TFunction,
} from "@/lib/i18n/core";

interface LangContextValue {
  lang: Lang;
  /** Locale Intl ("id-ID" / "en-US") untuk toLocaleString dkk. */
  locale: string;
  t: TFunction;
  setLang: (lang: Lang) => Promise<void>;
}

const COOKIE_RE = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=(en|id)`);
const readCookieLang = (): Lang => (COOKIE_RE.exec(document.cookie)?.[1] === "en" ? "en" : "id");
const serverLang = (): Lang => "id";

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

let enDict: Dict | null = null;
const fetchEn = () =>
  loadEnDict().then((d) => {
    enDict = d;
    return d;
  });

// Mulai unduh kamus EN sedini mungkin (sebelum hidrasi) bila pengguna memilih EN; pengguna ID tidak mengunduhnya.
if (typeof document !== "undefined" && readCookieLang() === "en") void fetchEn().catch(() => {});

const idT = makeT("id", null);
const LangContext = createContext<LangContextValue>({
  lang: "id",
  locale: localeOf("id"),
  t: idT,
  setLang: async () => {},
});

/**
 * Bahasa antarmuka di sisi klien. HTML statis selalu dirender dalam bahasa Indonesia (shell tetap bisa
 * di-prerender); setelah hidrasi, cookie `lang` dibaca dan teks berganti ke EN begitu kamusnya termuat.
 * Skrip di <head> menyembunyikan halaman sesaat (maks. 1,5 dtk) untuk pengguna EN agar tidak berkedip.
 */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const cookieLang = useSyncExternalStore(subscribe, readCookieLang, serverLang);
  const [dict, setDict] = useState<Dict | null>(() => enDict);

  useEffect(() => {
    if (cookieLang !== "en" || dict) return;
    let alive = true;
    fetchEn()
      .then((d) => {
        if (alive) setDict(d);
      })
      .catch(() => {
        // Kamus gagal dimuat (jaringan): tetap tampil dalam bahasa Indonesia.
        document.documentElement.classList.remove("i18n-wait");
      });
    return () => {
      alive = false;
    };
  }, [cookieLang, dict]);

  const lang: Lang = cookieLang === "en" && dict ? "en" : "id";

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    if (cookieLang === lang) root.classList.remove("i18n-wait");
  }, [lang, cookieLang]);

  const setLang = useCallback(
    async (next: Lang) => {
      if (next === "en") setDict(await fetchEn());
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
      listeners.forEach((cb) => cb());
      // Server Component (judul tab, halaman hasil OAuth) ikut dirender ulang; sesi tidak tersentuh.
      router.refresh();
    },
    [router]
  );

  const value = useMemo<LangContextValue>(() => {
    const t = lang === "en" ? makeT("en", dict) : idT;
    // Helper murni (format tanggal dll.) memakai `tr()`; disetel sebelum anak-anak dirender.
    setCurrentT(lang, t);
    return { lang, locale: localeOf(lang), t, setLang };
  }, [lang, dict, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/** Fungsi terjemahan untuk Client Component: `const t = useT(); t("Simpan")`. */
export function useT(): TFunction {
  return useContext(LangContext).t;
}

/** Bahasa aktif, locale Intl, dan pengganti bahasa. */
export function useLang(): LangContextValue {
  return useContext(LangContext);
}
