import { cookies } from "next/headers";
import { LANG_COOKIE, loadEnDict, makeT, parseLang, type Lang, type TFunction } from "./core";

/**
 * Bahasa untuk Server Component, dibaca dari cookie `lang`.
 * Catatan Cache Components: cookies() menunda render ke waktu permintaan, jadi panggil hanya di bagian yang
 * memang dinamis (di dalam <Suspense>) atau di generateMetadata halaman yang sudah punya bagian dinamis.
 */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

/** Fungsi `t` untuk Server Component; kamus EN hanya dimuat bila bahasa = EN. */
export async function getT(): Promise<TFunction> {
  const lang = await getLang();
  return makeT(lang, lang === "en" ? await loadEnDict() : null);
}
