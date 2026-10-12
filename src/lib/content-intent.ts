/**
 * Deteksi niat membuat/merevisi draf konten dari pesan chat (murni, tanpa I/O).
 *
 * Lebih ketat dari regex PRD: butuh kata kerja pembuatan/revisi DAN kata benda konten, supaya
 * pertanyaan analitik biasa ("post terbaik minggu ini?") tidak salah masuk ke jalur draf.
 */
import { MAX_RECOMMEND_COUNT } from "./content-config";
import type { PublishAccount } from "./publish-accounts";

const VERB =
  /\b(buat(?:kan)?|bikin(?:kan)?|tulis(?:kan)?|susun(?:kan)?|rekomendasi(?:kan)?|rekomen|saran(?:kan)?|jadwalkan|ganti|ubah|revisi|perbaiki|singkat(?:kan)?|panjangkan|ide|rangkai(?:kan)?|racik)\b/i;
const NOUN = /\b(draf|draft|konten|caption|postingan|posting|post|hook|ide|thread|threads|cuitan)\b/i;
const HOWTO = /\b(cara|tips|bagaimana|gimana|kenapa|mengapa|apa itu|apa yang)\b/i;
const REVISE = /\b(ganti|ubah|revisi|perbaiki|singkat(?:kan)?|panjangkan|lebih|jadwalkan|pendekkan|ringkas)\b/i;
const AGREE_PUBLISH = /\b(gpp|gapapa|enggak apa-apa|oke|ok|baik|setuju|sip|mantap|lanjut|yaudah|ya udah)\s+(?:posting(?:kan|in)?|post|publish|tayang(?:kan)?|jadwal(?:kan|in)?)\b|\b(?:posting(?:kan|in)?|post|publish|tayang(?:kan)?|jadwal(?:kan|in)?)\s+(?:aja|saja|langsung|sekarang)\b/i;

const ORCHESTRATOR_WORD = /\b(orchestrator|orkestra(?:si|tor)|multi[- ]?agen(?:t)?)\b/i;
const ALL_ACCOUNTS = /\b(semua|seluruh|tiap|setiap|masing-masing|banyak)\s+(akun|cabang|outlet)\b/i;
const IDEA_REQUEST = /\b(buat|bikin)(?:kan)?\b.*\bide\s+konten\b/i;

/**
 * Permintaan membuat konten untuk banyak akun sekaligus (membuka Multi-Agent Orchestrator):
 * menyebut orkestrator/multi-agent, meminta konten untuk semua akun, atau "buat ide konten" tanpa
 * menyebut akun tertentu. Pertanyaan analitik ("postingan terbaik?") tidak ikut tertangkap.
 */
export function isOrchestratorIntent(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 600) return false;
  if (AGREE_PUBLISH.test(t)) return false;
  if (ORCHESTRATOR_WORD.test(t)) return true;
  if (HOWTO.test(t) || !VERB.test(t) || !NOUN.test(t)) return false;
  return ALL_ACCOUNTS.test(t) || (IDEA_REQUEST.test(t) && !t.includes("@"));
}

const NUMBER_WORDS: Record<string, number> = {
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
};

export interface DraftIntent {
  count: number;
  /** Selisih hari WIB dari hari ini ("besok" = 1); null bila tidak disebut. */
  dayOffset: number | null;
  /** Permintaan mengubah draf yang sudah ada (butuh `lastDrafts`). */
  revise: boolean;
  /** Nomor draf (1-based) yang dimaksud saat revisi; null bila tidak disebut. */
  reviseIndex: number | null;
  /** Jam WIB yang diminta ("jam 7 malam" = 19); null bila tidak disebut. */
  hourWib: number | null;
}

export function parseHour(text: string): number | null {
  const m = /\bjam\s*(\d{1,2})(?:[.:](\d{2}))?\s*(pagi|siang|sore|malam)?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  if (!Number.isInteger(h) || h < 0 || h > 24) return null;
  const period = m[3]?.toLowerCase();
  if (period === "siang") h = h < 11 ? h + 12 : h; // 1 siang = 13, 12 siang = 12
  else if (period === "sore") h = h < 12 ? h + 12 : h;
  else if (period === "malam") h = h === 12 ? 0 : h < 12 ? h + 12 : h;
  else if (period === "pagi" && h === 12) h = 0;
  if (h === 24) h = 0;
  return h >= 0 && h <= 23 ? h : null;
}

function parseCount(text: string): number | null {
  const digit = /(\d{1,2})\s*(?:draf|draft|post|postingan|posting|konten|caption|hook|ide|thread)/i.exec(text);
  if (digit) return Math.min(MAX_RECOMMEND_COUNT, Math.max(1, Number(digit[1])));
  const word = /\b(satu|dua|tiga|empat|lima)\s+(?:draf|draft|post|postingan|posting|konten|caption|hook|ide|thread)/i.exec(text);
  if (word) return NUMBER_WORDS[word[1].toLowerCase()];
  return null;
}

/** Null bila pesan bukan permintaan draf. */
export function parseDraftIntent(text: string, hasLastDrafts: boolean): DraftIntent | null {
  const t = text.trim();
  if (!t || t.length > 600) return null;
  if (AGREE_PUBLISH.test(t)) return null;
  if (!VERB.test(t) || !NOUN.test(t) || HOWTO.test(t)) return null;

  const explicitCount = parseCount(t);
  const idx0 = /\b(?:draf|draft)\s*(?:ke-?|nomor|no\.?\s*)?(\d)\b/i.test(t);
  const revise =
    hasLastDrafts && REVISE.test(t) && /\b(draf|draft|tadi|lebih)\b/i.test(t) && (idx0 || explicitCount === null);
  const idx = /\b(?:draf|draft)\s*(?:ke-?|nomor|no\.?\s*)?(\d)\b/i.exec(t);
  const reviseIndex = idx ? Number(idx[1]) : null;

  let dayOffset: number | null = null;
  if (/\blusa\b/i.test(t)) dayOffset = 2;
  else if (/\bbesok\b/i.test(t)) dayOffset = 1;
  else if (/\bhari ini\b/i.test(t)) dayOffset = 0;

  const count = revise ? (reviseIndex ? 1 : null) : explicitCount;
  return {
    count: count ?? (revise ? 1 : 3),
    dayOffset,
    revise,
    reviseIndex,
    hourWib: parseHour(t),
  };
}

/**
 * Akun yang disebut di pesan: @username, username polos (>= 4 karakter), atau nama cabang persis.
 * Urutan sesuai kemunculan di daftar akun; tanpa duplikat.
 */
export function findMentionedAccounts(text: string, accounts: PublishAccount[]): PublishAccount[] {
  const q = text.toLowerCase();
  const out: PublishAccount[] = [];
  for (const a of accounts) {
    const u = a.username?.toLowerCase();
    const outlet = a.outletNama?.toLowerCase();
    const byUser = u && u.length >= 4 && new RegExp(`(?:^|[^a-z0-9_.])@?${escapeRegex(u)}(?![a-z0-9_.])`).test(q);
    const byOutlet = outlet && outlet.length >= 4 && q.includes(outlet);
    if (byUser || byOutlet) out.push(a);
  }
  return out;
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface PublishIntent {
  /** now = langsung masuk antrean terbit; schedule = dijadwalkan ke jam terbaik/jam yang diminta. */
  mode: "now" | "schedule";
  /** Selisih hari WIB ("besok" = 1); null = slot terdekat. */
  dayOffset: number | null;
  /** Jam WIB yang diminta; null = jam ramai tiap akun. */
  hourWib: number | null;
}

const PUBLISH_VERB = "(?:posting(?:kan|in)?|post|terbit(?:kan)?|upload|unggah|publish|tayang(?:kan)?)";
const PUBLISH_NOW = new RegExp(
  String.raw`\b${PUBLISH_VERB}\s+(?:\S+\s+){0,4}?(?:sekarang|langsung|skrg|saat ini)\b|\blangsung\s+${PUBLISH_VERB}\b|\bsekarang\s+juga\b`,
  "i"
);
const PUBLISH_SCHEDULE = new RegExp(
  String.raw`\b(?:jadwal(?:kan|in)|terjadwal|schedule)\b|\b${PUBLISH_VERB}\s+(?:\S+\s+){0,4}?(?:besok|lusa|nanti|jam|pukul|hari ini)\b`,
  "i"
);

/**
 * Perintah eksplisit untuk memposting/menjadwalkan, bukan sekadar meminta ide atau draf.
 * "posting sekarang ke semua akun", "jadwalkan besok jam 7 malam", "langsung post".
 */
export function parsePublishIntent(text: string): PublishIntent | null {
  const t = text.trim();
  if (!t || t.length > 600 || /\b(cara|bagaimana|gimana|kenapa|kapan)\b/i.test(t)) return null;
  const now = PUBLISH_NOW.test(t);
  if (!now && !PUBLISH_SCHEDULE.test(t)) return null;
  let dayOffset: number | null = null;
  const inDays = /\b(\d{1,2})\s*hari\s+lagi\b/i.exec(t);
  if (inDays) dayOffset = Math.min(30, Number(inDays[1]));
  else if (/\blusa\b/i.test(t)) dayOffset = 2;
  else if (/\bbesok\b/i.test(t)) dayOffset = 1;
  else if (/\bhari ini\b/i.test(t)) dayOffset = 0;
  const hourWib = parseHour(t);
  const schedule = !now || dayOffset !== null || hourWib !== null;
  return { mode: now && !schedule ? "now" : "schedule", dayOffset, hourWib };
}
