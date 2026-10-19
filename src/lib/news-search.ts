/**
 * Pencarian berita lewat Google News RSS (publik, tanpa kunci API dan tanpa kuota Google Search Gemini).
 * Dipakai sumber radar sebagai jalur cadangan saat grounding Gemini tidak tersedia: server mengambil judul
 * berita terbaru untuk beberapa kata kunci, lalu AI memilih trennya dengan fakta HANYA dari judul itu.
 *
 * Isi dari luar hanyalah DATA: judul dibersihkan, tautan yang tidak sah atau terlalu panjang dibuang (tautan
 * terpotong pasti rusak), dan tren tanpa berita rujukan dianggap karangan.
 */
import { cleanExternal } from "./radar-sources";

const HOUR_MS = 60 * 60 * 1000;
const NEWS_TIMEOUT_MS = 8000;
const MAX_NEWS_BYTES = 400_000;
/** Berita yang dianggap masih hangat (bawaan). */
export const NEWS_MAX_AGE_MS = 72 * HOUR_MS;
const NEWS_PER_QUERY = 12;
const NEWS_FOR_PROMPT = 36;

export interface NewsItem {
  title: string;
  source: string | null;
  link: string | null;
  /** epoch ms */
  publishedAt: number;
}

export interface NewsQuery {
  q: string;
  /** true = Google News internasional (bahasa Inggris); false = Google News Indonesia. */
  global: boolean;
}

/** URL pencarian Google News RSS untuk berita beberapa hari terakhir. */
export function newsSearchUrl(query: string, global: boolean, days = 3): string {
  const q = encodeURIComponent(`${query} when:${days}d`);
  return global
    ? `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
    : `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;
}

const xmlTag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1] : null;
};

/** Urai umpan Google News RSS (murni, toleran terhadap butir rusak); hanya berita yang cukup baru. */
export function parseNewsRss(xml: string, now: Date, maxAgeMs = NEWS_MAX_AGE_MS): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const source = cleanExternal(xmlTag(body, "source") ?? "", 60) || null;
    let title = cleanExternal(xmlTag(body, "title") ?? "", 200);
    // Judul Google News berakhiran " - Nama Media".
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const publishedAt = Date.parse(xmlTag(body, "pubDate") ?? "");
    if (title.length < 10 || !Number.isFinite(publishedAt)) continue;
    if (now.getTime() - publishedAt > maxAgeMs || publishedAt - now.getTime() > HOUR_MS) continue;
    // Tautan tidak dipotong: tautan terpotong pasti rusak, jadi yang terlalu panjang dibuang.
    const rawLink = (xmlTag(body, "link") ?? "").replace(/&amp;/g, "&").trim();
    const link = rawLink.length <= 500 && /^https:\/\/[^\s<>"]+$/.test(rawLink) ? rawLink : null;
    out.push({ title, source, link, publishedAt });
  }
  return out;
}

async function fetchNews(query: NewsQuery, now: Date, days: number, maxAgeMs: number): Promise<NewsItem[]> {
  const res = await fetch(newsSearchUrl(query.q, query.global, days), {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BotDashboard/1.0)", Accept: "application/rss+xml, text/xml" },
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google News membalas ${res.status}`);
  return parseNewsRss((await res.text()).slice(0, MAX_NEWS_BYTES), now, maxAgeMs).slice(0, NEWS_PER_QUERY);
}

/** Gabungkan hasil beberapa pencarian: buang judul kembar (yang paling baru disimpan), paling baru dulu. */
export function mergeNews(lists: NewsItem[][], max = NEWS_FOR_PROMPT): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of lists.flat().sort((a, b) => b.publishedAt - a.publishedAt)) {
    const key = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Cari beberapa kata kunci sekaligus (sejajar) lalu gabungkan. Satu pencarian gagal tidak menghentikan yang
 * lain; `keep` menyaring judul sebelum digabung (mis. membuang berita keras).
 */
export async function searchNews(
  queries: NewsQuery[],
  now: Date,
  opts: { days?: number; maxAgeMs?: number; max?: number; keep?: (item: NewsItem) => boolean } = {}
): Promise<NewsItem[]> {
  const days = opts.days ?? 3;
  const lists = await Promise.all(
    queries.map((query) =>
      fetchNews(query, now, days, opts.maxAgeMs ?? days * 24 * HOUR_MS).catch((err) => {
        console.warn(`[radar] Google News "${query.q}":`, err instanceof Error ? err.message : err);
        return [] as NewsItem[];
      })
    )
  );
  return mergeNews(opts.keep ? lists.map((l) => l.filter(opts.keep!)) : lists, opts.max);
}

const ageLabel = (ms: number): string => {
  const h = Math.max(1, Math.round(ms / HOUR_MS));
  return h < 24 ? `${h} jam lalu` : `${Math.round(h / 24)} hari lalu`;
};

/** Baris prompt berita bernomor: "[1] Judul (Media, 3 jam lalu)". */
export const newsLines = (news: NewsItem[], now: Date): string[] =>
  news.map((n, i) => `[${i + 1}] ${n.title} (${[n.source, ageLabel(now.getTime() - n.publishedAt)].filter(Boolean).join(", ")})`);

/**
 * Hubungkan tren keluaran AI dengan berita rujukannya (kolom `berita` = nomor berita): tren tanpa rujukan
 * sah dibuang sebagai karangan, tautan diambil dari berita pertama yang punya tautan, dan `domains` berisi
 * domain tautan berita (untuk penyaring URL tepercaya).
 */
export function linkNews<T extends object>(topics: unknown, news: NewsItem[]): { topics: (T & { url?: string })[]; domains: string[] } {
  const linked = (Array.isArray(topics) ? topics : [])
    .filter((t): t is T & { berita?: unknown } => typeof t === "object" && t !== null)
    .map((t) => {
      const refs = (Array.isArray(t.berita) ? t.berita : [])
        .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= news.length)
        .map((n) => news[n - 1]);
      return { t, refs };
    })
    .filter(({ refs }) => refs.length > 0)
    .map(({ t, refs }) => ({ ...t, url: refs.find((r) => r.link)?.link ?? undefined }));
  const domains = [
    ...new Set(
      news
        .map((n) => {
          try {
            return n.link ? new URL(n.link).hostname.replace(/^www\./, "") : null;
          } catch {
            return null;
          }
        })
        .filter((d): d is string => !!d)
    ),
  ];
  return { topics: linked, domains };
}
