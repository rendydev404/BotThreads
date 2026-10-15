/**
 * Sumber sinyal radar yang diambil server dashboard sendiri (tanpa token Threads):
 * - tren pencarian Indonesia (umpan RSS Google Trends, publik);
 * - momen kalender bawaan (gajian, akhir pekan, tanggal tua, awal pekan).
 *
 * Isi dari luar hanyalah DATA untuk inspirasi topik. Teksnya dibersihkan dan disaring dari topik
 * sensitif sebelum disimpan, dan tidak pernah disalin ke draf.
 */
import { DEFAULT_BANNED_TERMS, bannedHits } from "./autopilot-gate";
import { BUILTIN_MOMENT_RULES, momentRuleActive } from "./moment-rules";
import { wibAt, wibDayKey, wibParts } from "./scheduling";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Tren pencarian cepat basi: dipakai paling lama 48 jam. */
export const TREND_TTL_MS = 48 * HOUR_MS;
export const TRENDS_URL = "https://trends.google.com/trending/rss?geo=ID";
const FETCH_TIMEOUT_MS = 8000;
const MAX_FEED_BYTES = 400_000;

/** Berita keras yang tidak pantas ditunggangi akun brand; melengkapi daftar terlarang bawaan. */
const HARD_NEWS_TERMS = [
  "presiden", "menteri", "dpr", "kpk", "korupsi", "tersangka", "ditangkap", "polisi", "pembunuhan", "tewas",
  "kecelakaan", "kebakaran", "banjir", "demo", "perang", "pengadilan", "vonis", "penipuan", "narkoba",
  "cpns", "asn", "pppk", "bansos", "login", "pengumuman hasil",
];

export interface SignalDraft {
  workspaceId?: string | null;
  source: "GTRENDS" | "MOMEN" | "MANUAL";
  title: string;
  summary?: string | null;
  url?: string | null;
  rank?: number | null;
  score: number;
  raw?: Record<string, unknown>;
  hash: string;
  /** ISO UTC */
  expiresAt: string;
  createdBy?: string;
}

const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Teks dari luar: buang tag dan karakter kendali, rapatkan spasi, potong. */
export const cleanExternal = (s: string, max: number): string =>
  decodeXml(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>{}\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1] : null;
};

/** "100+", "2K+", "50.000+" -> angka perkiraan; 0 bila tidak terbaca. */
export function parseTraffic(raw: string | null): number {
  if (!raw) return 0;
  const m = /([\d.,]+)\s*([KkMm])?/.exec(raw);
  if (!m) return 0;
  const n = Number(m[1].replace(/[.,]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return n * (m[2] ? (m[2].toLowerCase() === "k" ? 1000 : 1_000_000) : 1);
}

export interface TrendItem {
  keyword: string;
  traffic: number;
  /** Judul berita pertama yang menjelaskan konteks tren (bila ada). */
  context: string | null;
  rank: number;
}

/** Urai umpan RSS Google Trends menjadi butir tren (murni, toleran terhadap butir rusak). */
export function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const keyword = cleanExternal(tag(body, "title") ?? "", 80);
    if (keyword.length < 2) continue;
    const news = tag(body, "ht:news_item_title");
    items.push({
      keyword,
      traffic: parseTraffic(tag(body, "ht:approx_traffic")),
      context: news ? cleanExternal(news, 160) || null : null,
      rank: items.length + 1,
    });
    if (items.length >= 30) break;
  }
  return items;
}

/** Tren ini aman dan masuk akal dijadikan inspirasi konten brand? */
export function isUsableTrend(item: TrendItem, extraBanned: string[] = []): boolean {
  const text = `${item.keyword} ${item.context ?? ""}`;
  return bannedHits(text, [...DEFAULT_BANNED_TERMS, ...HARD_NEWS_TERMS, ...extraBanned]).length === 0;
}

/** Skor 0..1 dari peringkat (urutan umpan = popularitas) dan volume pencarian. */
export function trendScore(item: TrendItem, total: number): number {
  const byRank = 1 - (item.rank - 1) / Math.max(total, 1);
  const byVolume = item.traffic > 0 ? Math.min(1, Math.log10(item.traffic) / 6) : 0.2;
  return Math.round((0.35 + 0.4 * byRank + 0.25 * byVolume) * 100) / 100;
}

export function trendsToSignals(items: TrendItem[], now: Date, extraBanned: string[] = []): SignalDraft[] {
  const day = wibDayKey(now);
  return items
    .filter((it) => isUsableTrend(it, extraBanned))
    .map((it) => ({
      workspaceId: null,
      source: "GTRENDS" as const,
      title: it.keyword,
      summary: it.context,
      rank: it.rank,
      score: trendScore(it, items.length),
      raw: { traffic: it.traffic },
      hash: `GTRENDS:${day}:${it.keyword.toLowerCase()}`,
      expiresAt: new Date(now.getTime() + TREND_TTL_MS).toISOString(),
    }));
}

/** Ambil umpan tren pencarian Indonesia. Melempar bila gagal; pemanggil yang memutuskan lanjut atau tidak. */
export async function fetchGoogleTrends(signal?: AbortSignal): Promise<TrendItem[]> {
  const res = await fetch(TRENDS_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BotDashboard/1.0)", Accept: "application/rss+xml, text/xml" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Umpan tren membalas ${res.status}`);
  const xml = (await res.text()).slice(0, MAX_FEED_BYTES);
  return parseTrendsRss(xml);
}

/* ------------------------------------------------------------------ momen bawaan */

/** Momen kalender bawaan yang berlaku hari ini (global, berlaku sampai akhir hari WIB). */
export function builtinMomentSignals(now: Date): SignalDraft[] {
  const p = wibParts(now);
  const day = wibDayKey(now);
  const endOfDay = new Date(wibAt(now, 0, 0).getTime() + DAY_MS).toISOString();
  return BUILTIN_MOMENT_RULES.filter((m) => momentRuleActive(m, p.d, p.dow)).map((m) => ({
    workspaceId: null,
    source: "MOMEN" as const,
    title: m.title,
    summary: m.summary,
    score: m.score,
    hash: `MOMEN:bawaan:${m.key}:${day}`,
    expiresAt: endOfDay,
  }));
}
