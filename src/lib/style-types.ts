/**
 * Kontrak bersama "otak gaya Threads": format postingan, fitur layout, contoh gaya dari korpus, skor
 * engagement relatif, dan pemeriksa anti-jiplak. Murni tanpa I/O (aman untuk server dan klien).
 *
 * Dipakai korpus gaya (style-corpus), penulis (content-ai/autopilot-writer), gerbang (autopilot-gate), dan
 * pembelajaran (autopilot-learning). Korpus dibatasi PER WORKSPACE: contoh gaya tidak pernah lintas pelanggan.
 */

/** Bentuk postingan yang umum di Threads. */
export const POST_FORMATS = ["CERITA", "OPINI", "TIPS_LIST", "PERTANYAAN", "INFO", "CURHAT", "PROMO"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export const POST_FORMAT_LABEL: Record<PostFormat, string> = {
  CERITA: "cerita pengalaman",
  OPINI: "opini / hot take",
  TIPS_LIST: "tips berbentuk daftar",
  PERTANYAAN: "pertanyaan pemancing obrolan",
  INFO: "info / edukasi singkat",
  CURHAT: "curhat / relatable",
  PROMO: "promosi",
};

export interface LayoutFeatures {
  /** Jumlah karakter (code point). */
  chars: number;
  /** Baris tidak kosong. */
  lines: number;
  /** Blok dipisah baris kosong. */
  paragraphs: number;
  /** Rata-rata karakter per baris tidak kosong. */
  avgLineChars: number;
  /** Minimal 2 baris berawalan nomor/bullet. */
  isList: boolean;
  /** Huruf pertama huruf kecil. */
  startsLowercase: boolean;
  emojiCount: number;
  endsQuestion: boolean;
}

const EMOJI_G = /\p{Extended_Pictographic}/gu;
const LIST_LINE = /^\s*(?:\d{1,2}[.)]|[-•*–]|[a-e][.)])\s+\S/;

/** Fitur layout satu teks (murni). Baris baru dipertahankan apa adanya: \r\n dinormalkan ke \n. */
export function layoutFeatures(raw: string): LayoutFeatures {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  const chars = [...text].length;
  const first = text.match(/\p{L}/u)?.[0] ?? "";
  return {
    chars,
    lines: lines.length,
    paragraphs,
    avgLineChars: lines.length ? Math.round(lines.reduce((a, l) => a + [...l.trim()].length, 0) / lines.length) : 0,
    isList: lines.filter((l) => LIST_LINE.test(l)).length >= 2,
    startsLowercase: !!first && first === first.toLowerCase() && first !== first.toUpperCase(),
    emojiCount: text.match(EMOJI_G)?.length ?? 0,
    endsQuestion: /\?\s*\p{Extended_Pictographic}*\s*$/u.test(text),
  };
}

const PROMO_RE = /\b(promo|diskon|order|pesan sekarang|link di bio|cek bio|harga|gratis ongkir|dm (aja|ya)|wa\s?\d|whatsapp|beli|cod)\b/i;
const STORY_RE = /\b(tadi|kemarin|dulu|waktu itu|pernah|minggu lalu|pas (gue|aku|saya)|ceritanya|jadi gini)\b/i;
const CURHAT_RE = /\b(capek|cape|lelah|sedih|kesel|bingung|overthinking|sendirian|nangis|insecure|gak kuat|pengen nyerah)\b/i;
const OPINI_RE = /\b(menurut (gue|aku|saya)|unpopular opinion|hot take|jujur(ly)?|gue (rasa|yakin)|aku (rasa|yakin)|harusnya|overrated|underrated)\b/i;
const INFO_RE = /\b(ternyata|tau gak|tahu nggak|fakta|data|riset|menurut (survei|studi)|cara|tips|biar|supaya)\b/i;

/**
 * Tebakan format dari teks (murni, tanpa AI). Urutan aturan penting: daftar dan promo paling jelas, pertanyaan
 * hanya bila teks pendek dan berakhir tanya (pertanyaan di akhir cerita panjang tetap CERITA/OPINI).
 */
export function detectFormat(raw: string): PostFormat {
  const text = raw.trim();
  const f = layoutFeatures(text);
  if (f.isList) return "TIPS_LIST";
  if (PROMO_RE.test(text)) return "PROMO";
  if (f.endsQuestion && f.chars <= 160) return "PERTANYAAN";
  if (CURHAT_RE.test(text)) return "CURHAT";
  if (STORY_RE.test(text)) return "CERITA";
  if (OPINI_RE.test(text)) return "OPINI";
  if (INFO_RE.test(text)) return "INFO";
  return f.endsQuestion ? "PERTANYAAN" : "OPINI";
}

export interface EngagementInput {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
}

/**
 * Skor engagement relatif terhadap median akun (murni), -2..2. Balasan diberi bobot lebih karena itu yang
 * paling didorong Threads: ln((views+1)/(medViews+1)) + 0.5 * ln((replies+1)/(medReplies+1)).
 */
export function engagementScore(m: EngagementInput, median: { views: number; replies: number }): number {
  const v = Math.log((Math.max(0, m.views) + 1) / (Math.max(0, median.views) + 1));
  const r = Math.log((Math.max(0, m.replies) + 1) / (Math.max(0, median.replies) + 1));
  return Math.max(-2, Math.min(2, v + 0.5 * r));
}

export type StyleSource = "OWN" | "WORKSPACE" | "MANUAL";

/** Satu contoh gaya untuk ditiru ritme dan layoutnya (bukan kalimatnya). */
export interface StyleExemplar {
  id: string;
  /** Teks asli LENGKAP dengan baris barunya. */
  text: string;
  format: PostFormat;
  features: LayoutFeatures;
  /** engagementScore (null untuk contoh manual tanpa metrik). */
  score: number | null;
  source: StyleSource;
  /** Handle penulis (akun sendiri/workspace) bila ada; contoh manual boleh null. */
  handle: string | null;
}

/** Ringkasan layout postingan yang berhasil di korpus satu akun/workspace (patokan "seperti apa yang ramai"). */
export interface LayoutProfile {
  /** Jumlah contoh yang diringkas. */
  sample: number;
  medianChars: number;
  medianLines: number;
  /** Porsi 0-1. */
  listShare: number;
  lowercaseShare: number;
  questionShare: number;
  emojiShare: number;
  /** Format terbanyak di antara postingan berskor tinggi, urut porsi. */
  topFormats: { format: PostFormat; share: number; avgScore: number }[];
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Potongan n kata pertama yang sama persis antara draf dan salah satu contoh (murni). Null bila tidak ada.
 * Dipakai gerbang anti-jiplak: yang ditiru ritme dan layout, bukan kalimat.
 */
export function copiedPhrase(draft: string, sources: string[], n = 6): string | null {
  const d = words(draft);
  if (d.length < n) return null;
  const grams = new Set<string>();
  for (const src of sources) {
    const w = words(src);
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" "));
  }
  for (let i = 0; i + n <= d.length; i++) {
    const g = d.slice(i, i + n).join(" ");
    if (grams.has(g)) return g;
  }
  return null;
}
