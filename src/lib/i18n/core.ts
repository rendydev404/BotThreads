/**
 * i18n ringan tanpa dependensi: teks sumber (bahasa Indonesia) sekaligus menjadi kunci terjemahan.
 *
 *   t("Hubungkan Threads")                -> "Connect Threads" (EN) / teks aslinya (ID)
 *   t("Dibalas {n} komentar", { n: 3 })   -> "Replied to 3 comments"
 *
 * Kamus EN (`./en`) hanya dimuat saat bahasa = EN (import dinamis), jadi pengguna ID tidak mengunduhnya.
 * Kunci yang belum diterjemahkan selalu jatuh ke teks Indonesia, tidak pernah menampilkan kunci mentah.
 * Bentuk jamak EN: tulis "satu||banyak" di kamus; dipilih dari variabel `n` (n === 1 -> bentuk pertama).
 * Kata sama beda arti: beri konteks setelah "@@" (t("Selesai@@tanggal")); ID tetap menampilkan "Selesai".
 */

export type Lang = "id" | "en";
export type Dict = Readonly<Record<string, string>>;
export type Vars = Record<string, string | number | null | undefined>;
export type TFunction = (key: string, vars?: Vars) => string;

export const LANG_COOKIE = "lang";
export const DEFAULT_LANG: Lang = "id";
/** Satu tahun: pilihan bahasa bertahan lintas sesi, termasuk setelah keluar-masuk. */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const parseLang = (v: string | null | undefined): Lang => (v === "en" ? "en" : "id");

/** Locale Intl untuk format tanggal/angka sesuai bahasa. */
export const localeOf = (lang: Lang): string => (lang === "en" ? "en-US" : "id-ID");

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(PLACEHOLDER, (m, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? m : String(v);
  });
}

/** Pemisah konteks untuk kata yang sama tapi beda arti: t("Selesai@@tanggal") tampil "Selesai" di ID. */
const CTX = "@@";

export function translate(dict: Dict | null, key: string, vars?: Vars): string {
  let text = (dict && dict[key]) || (key.includes(CTX) ? key.slice(0, key.indexOf(CTX)) : key);
  if (text.includes("||")) {
    const [one, many] = text.split("||");
    text = Number(vars?.n) === 1 ? one : many ?? one;
  }
  return interpolate(text, vars);
}

export function makeT(lang: Lang, dict: Dict | null): TFunction {
  const d = lang === "en" ? dict : null;
  return (key, vars) => translate(d, key, vars);
}

/**
 * Terjemahan untuk helper murni di luar React (format tanggal, label status di modul lain).
 * Hanya LangProvider di browser yang mengubahnya; di server selalu bahasa Indonesia, jadi aman lintas permintaan.
 * Komponen yang menampilkan hasil helper ini sebaiknya tetap memanggil useT()/useLang() agar ikut dirender ulang
 * saat bahasa berganti.
 */
let currentT: TFunction = makeT("id", null);
let currentLang: Lang = "id";
export const tr: TFunction = (key, vars) => currentT(key, vars);
export const currentLocale = (): string => localeOf(currentLang);
export function setCurrentT(lang: Lang, t: TFunction): void {
  if (typeof window === "undefined") return;
  currentLang = lang;
  currentT = t;
}

let enPromise: Promise<Dict> | null = null;
/** Muat kamus EN sekali (chunk terpisah); dipakai server maupun klien. */
export function loadEnDict(): Promise<Dict> {
  if (!enPromise) {
    enPromise = import("./en").then((m) => m.default).catch((err) => {
      enPromise = null;
      throw err;
    });
  }
  return enPromise;
}
