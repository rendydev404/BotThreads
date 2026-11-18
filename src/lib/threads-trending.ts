/**
 * Radar > Tren Viral > "Trending di Threads": topik yang sedang tren di aplikasi Threads beserta postingannya
 * (fitur Meta "Threads Trending Topics", https://developers.facebook.com/documentation/threads/trending-topics).
 *
 * - `GET /trending_topics?country_code=..` memakai token aplikasi (`TH|<app id>|<app secret>`), bukan token
 *   akun pengguna. Per November 2026 Threads hanya mengisi Amerika Serikat dan Jepang; `ID` dijawab kosong.
 *   Indonesia tetap jadi pilihan utama: selama kosong, tren Amerika Serikat ditampilkan sebagai cadangan
 *   (`fallbackFrom`), dan begitu Threads membuka tren Indonesia hasilnya langsung dipakai.
 * - `GET /{trend_id}/posts` butuh akses lanjutan fitur ini (lolos App Review). Sebelum itu Threads menjawab
 *   403 / kode 10; itu dikembalikan sebagai `approved: false`, bukan galat.
 * - Tren berubah paling cepat sekali per jam, jadi daftar tren disimpan di memori proses 1 jam dan dipakai
 *   bersama oleh semua pengguna (1 panggilan API per negara per jam). Posting per tren disimpan 10 menit.
 * - Ketentuan Meta: data tren tidak boleh dipindahkan atau diubah. Data hanya ditampilkan apa adanya dengan
 *   tautan ke Threads; tidak disimpan ke database.
 */
import { getRawIntegrations } from "./integrations";

const GRAPH = "https://graph.threads.net/v1.0";
const FETCH_TIMEOUT_MS = 10_000;
export const TOPICS_TTL_MS = 60 * 60_000;
export const POSTS_TTL_MS = 10 * 60_000;
/** Gagal mengambil: jangan coba lagi lebih cepat dari ini (hemat kuota, tetap sajikan data lama bila ada). */
const RETRY_AFTER_ERROR_MS = 2 * 60_000;
const POSTS_LIMIT = 10;
const POSTS_CACHE_MAX = 200;
const POST_FIELDS = "id,username,text,timestamp,media_type,permalink";

export const TREND_COUNTRIES = ["ID", "US"] as const;
/** Negara cadangan bila tren negara yang diminta kosong. */
const FALLBACK_COUNTRY: TrendCountry = "US";
export type TrendCountry = (typeof TREND_COUNTRIES)[number];
export type TrendPostType = "top" | "recent";

export interface TrendingTopic {
  trendId: string;
  title: string;
  /** Tidak tersedia untuk Jepang. */
  description: string | null;
}

export interface TrendPost {
  id: string;
  username: string;
  text: string;
  mediaType: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export type TopicsResult =
  | {
      ok: true;
      /** Negara asal tren yang ditampilkan. */
      country: TrendCountry;
      /** Negara yang diminta tapi kosong di Threads, sehingga `country` dipakai sebagai cadangan. */
      fallbackFrom: TrendCountry | null;
      topics: TrendingTopic[];
      fetchedAt: string;
    }
  | { ok: false; status: number; error: string };

export type PostsResult =
  | { ok: true; approved: true; posts: TrendPost[]; fetchedAt: string }
  | { ok: true; approved: false; posts: []; fetchedAt: string }
  | { ok: false; status: number; error: string };

export const isTrendCountry = (v: unknown): v is TrendCountry => TREND_COUNTRIES.includes(v as TrendCountry);
export const isTrendId = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null
  ) {
    super(message);
  }
}

async function appToken(): Promise<string | null> {
  const { appId, appSecret } = (await getRawIntegrations()).threadsOauth;
  return appId && appSecret ? `TH|${appId}|${appSecret}` : null;
}

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = `${GRAPH}${path}?${new URLSearchParams({ ...params, access_token: token })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || body.error) {
    throw new GraphError(body.error?.message || `Threads API error (${res.status})`, res.status, body.error?.code ?? null);
  }
  return body;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function toTopics(raw: unknown): TrendingTopic[] {
  const list = (raw as { trends?: unknown[] } | null)?.trends;
  if (!Array.isArray(list)) return [];
  const out: TrendingTopic[] = [];
  for (const t of list as { trend_id?: unknown; title?: unknown; description?: unknown }[]) {
    const trendId = typeof t?.trend_id === "number" ? String(t.trend_id) : clean(t?.trend_id);
    const title = clean(t?.title);
    if (!isTrendId(trendId) || !title) continue;
    out.push({ trendId, title, description: clean(t.description) || null });
  }
  return out;
}

export function toPosts(raw: unknown): TrendPost[] {
  const list = (raw as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(list)) return [];
  const out: TrendPost[] = [];
  for (const p of list as Record<string, unknown>[]) {
    const id = clean(p?.id);
    if (!id) continue;
    out.push({
      id,
      username: clean(p.username),
      text: clean(p.text),
      mediaType: clean(p.media_type) || null,
      permalink: clean(p.permalink) || null,
      timestamp: clean(p.timestamp) || null,
    });
  }
  return out;
}

/** Threads menolak karena fitur belum disetujui (akses lanjutan). */
export const notApproved = (err: unknown): boolean =>
  err instanceof GraphError && (err.status === 403 || err.code === 10 || err.code === 200);

interface Entry<T> {
  value: T | null;
  at: number;
  failedAt: number;
  lastError: unknown;
  pending: Promise<void> | null;
}

const topicsCache = new Map<TrendCountry, Entry<{ topics: TrendingTopic[] }>>();
const postsCache = new Map<string, Entry<{ approved: boolean; posts: TrendPost[] }>>();

/** Kosongkan cache (uji). */
export function forgetTrending(): void {
  topicsCache.clear();
  postsCache.clear();
}

/**
 * Ambil dari cache bila masih segar; kalau tidak, satu permintaan bersama per kunci (permintaan lain menunggu
 * hasil yang sama). Gagal: kembalikan data lama bila ada, dan tahan percobaan berikutnya sebentar.
 */
async function cached<K, T>(
  map: Map<K, Entry<T>>,
  key: K,
  ttl: number,
  load: () => Promise<T>,
  now: () => number
): Promise<{ value: T; at: number } | { error: unknown }> {
  let e = map.get(key);
  if (!e) {
    e = { value: null, at: 0, failedAt: 0, lastError: null, pending: null };
    map.set(key, e);
  }
  const fresh = e.value !== null && now() - e.at < ttl;
  const cooling = e.failedAt > 0 && now() - e.failedAt < RETRY_AFTER_ERROR_MS;
  if (!fresh && !cooling) {
    if (!e.pending) {
      const entry = e;
      entry.pending = load()
        .then((v) => {
          entry.value = v;
          entry.at = now();
          entry.failedAt = 0;
          entry.lastError = null;
        })
        .catch((err: unknown) => {
          entry.failedAt = now();
          entry.lastError = err;
        })
        .finally(() => {
          entry.pending = null;
        });
    }
    await e.pending;
  }
  if (e.value !== null) return { value: e.value, at: e.at };
  return { error: e.lastError ?? new Error("Threads API tidak menjawab.") };
}

function failure(err: unknown, scope: string): { ok: false; status: number; error: string } {
  console.warn(`[threads-trending] ${scope}:`, err instanceof Error ? err.message : err);
  return { ok: false, status: 502, error: "Tren Threads belum bisa diambil. Coba lagi beberapa menit lagi." };
}

async function topicsOf(country: TrendCountry, token: string, now: () => number) {
  return cached(
    topicsCache,
    country,
    TOPICS_TTL_MS,
    async () => ({ topics: toTopics(await graph("/trending_topics", { country_code: country }, token)) }),
    now
  );
}

export async function trendingTopics(country: TrendCountry, now: () => number = Date.now): Promise<TopicsResult> {
  const token = await appToken();
  if (!token) return { ok: false, status: 503, error: "Threads App ID dan App Secret belum dikonfigurasi." };
  // Negara diminta dan cadangannya diambil bersamaan (masing-masing tetap dicache 1 jam), jadi saat cache
  // kosong pengguna menunggu satu panggilan API, bukan dua berurutan.
  const [r, fbr] = await Promise.all([
    topicsOf(country, token, now),
    country !== FALLBACK_COUNTRY ? topicsOf(FALLBACK_COUNTRY, token, now) : Promise.resolve(null),
  ]);
  const asked = "error" in r ? null : r;
  if (asked && asked.value.topics.length > 0) {
    return { ok: true, country, fallbackFrom: null, topics: asked.value.topics, fetchedAt: new Date(asked.at).toISOString() };
  }
  if (fbr) {
    // Kosong atau gagal untuk negara ini (mis. Indonesia belum dibuka Threads): pakai tren cadangan.
    const fb = fbr;
    if (!("error" in fb) && fb.value.topics.length > 0) {
      return { ok: true, country: FALLBACK_COUNTRY, fallbackFrom: country, topics: fb.value.topics, fetchedAt: new Date(fb.at).toISOString() };
    }
  }
  if (asked) return { ok: true, country, fallbackFrom: null, topics: [], fetchedAt: new Date(asked.at).toISOString() };
  return failure((r as { error: unknown }).error, `topics ${country}`);
}

export async function trendPosts(trendId: string, type: TrendPostType, now: () => number = Date.now): Promise<PostsResult> {
  const token = await appToken();
  if (!token) return { ok: false, status: 503, error: "Threads App ID dan App Secret belum dikonfigurasi." };
  const key = `${trendId}:${type}`;
  if (!postsCache.has(key) && postsCache.size >= POSTS_CACHE_MAX) {
    const oldest = postsCache.keys().next().value;
    if (oldest !== undefined) postsCache.delete(oldest);
  }
  const r = await cached(
    postsCache,
    key,
    POSTS_TTL_MS,
    async () => {
      try {
        const raw = await graph(`/${trendId}/posts`, { trending_post_type: type, fields: POST_FIELDS, limit: String(POSTS_LIMIT) }, token);
        return { approved: true, posts: toPosts(raw).slice(0, POSTS_LIMIT) };
      } catch (err) {
        // Belum disetujui Meta: simpan juga (10 menit) supaya tidak menembak API terus-menerus.
        if (notApproved(err)) return { approved: false, posts: [] };
        throw err;
      }
    },
    now
  );
  if ("error" in r) return failure(r.error, `posts ${trendId}`);
  const fetchedAt = new Date(r.at).toISOString();
  return r.value.approved
    ? { ok: true, approved: true, posts: r.value.posts, fetchedAt }
    : { ok: true, approved: false, posts: [], fetchedAt };
}
