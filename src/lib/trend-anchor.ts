/**
 * Jangkar tren (murni, tanpa I/O): kata kunci yang WAJIB muncul di draf supaya postingan benar-benar
 * menumpang tren yang dipilih ide, bukan cuma "senada" dengan niche akun.
 *
 * - Kuat: nama diri di tengah kalimat (Gemini, Argon, Minecraft, Devin) dan token bercampur angka (GPT-5).
 *   Draf lolos bila menyebut salah satunya.
 * - Lemah: kata isi panjang dari judul ber-Huruf-Kapital-Semua (judul berita), dipakai bila tidak ada
 *   jangkar kuat. Draf lolos bila menyebut salah satunya.
 * Tanpa jangkar sama sekali (tren terlalu umum), pemeriksaan dilewati.
 */

const STOP = new Set(
  (
    "dan yang di ke dari untuk dengan ini itu ada pada akan atau juga karena jadi bisa lagi masih sudah baru " +
    "gue gua lo lu aku kamu kita kami saya mereka dia jam hari minggu bulan tahun viral tren trend naik ramai " +
    "cuma sama satu dua tiga bikin buat kalau kayak banget soal antara jadi makin lebih paling tapi tetap"
  ).split(" ")
);

/** Kata generik niche teknologi yang terlalu umum untuk jadi bukti menumpang tren. */
const GENERIC = new Set(["ai", "app", "aplikasi", "teknologi", "internet", "indonesia", "orang", "pengguna"]);

export interface TrendAnchors {
  strong: string[];
  weak: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
}

/** Jangkar dari topik ide dan judul tren yang dirujuknya. */
export function trendAnchors(texts: string[]): TrendAnchors {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const raw of texts) {
    const ws = words(raw);
    if (!ws.length) continue;
    const capital = ws.filter((w) => /^\p{Lu}/u.test(w)).length;
    // Judul berita sering Huruf Kapital Semua: kapital tidak lagi menandai nama diri.
    const titleCase = capital / ws.length > 0.6;
    ws.forEach((w, i) => {
      const n = norm(w);
      if (n.length < 3 || STOP.has(n) || GENERIC.has(n)) return;
      if (/\p{L}/u.test(w) && /\d/.test(w)) strong.add(n);
      else if (!titleCase && i > 0 && /^\p{Lu}/u.test(w)) strong.add(n);
      else if (n.length >= 5 && !/^\d+$/.test(n)) weak.add(n);
    });
  }
  return { strong: [...strong], weak: [...weak].filter((w) => !strong.has(w)) };
}

/** Draf menyebut tren? true bila tidak ada jangkar (tidak bisa diperiksa). */
export function mentionsTrend(text: string, anchors: TrendAnchors | null | undefined): boolean {
  if (!anchors) return true;
  const list = anchors.strong.length ? anchors.strong : anchors.weak;
  if (!list.length) return true;
  const t = ` ${norm(text)} `;
  return list.some((a) => t.includes(` ${a} `) || t.includes(` ${a}`));
}

/** Contoh jangkar untuk catatan perbaikan ke penulis AI. */
export const anchorHint = (a: TrendAnchors): string => (a.strong.length ? a.strong : a.weak).slice(0, 4).join(", ");
