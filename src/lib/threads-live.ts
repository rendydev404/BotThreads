/**
 * Angka HARI INI langsung dari API Threads untuk dasbor.
 *
 * Worker auto-suka hanya menyimpan ThreadsAccountDaily/ThreadsPostStat s.d. kemarin (sekali sehari
 * setelah 05.00 WIB), jadi hari ini tidak pernah ada di database. Per akun diambil 3 panggilan:
 * metrik akun sejak 00.00 WIB, jumlah followers saat ini, dan postingan sejak 00.00 WIB. Metrik akun
 * dijumlahkan dengan cara yang sama seperti worker (semua bucket `values` dijumlah), sehingga angka
 * hari ini sebanding dengan hari-hari sebelumnya.
 *
 * Hasil disimpan di memori LIVE_TTL_MS per akun dan permintaan serentak digabung, jadi dasbor yang
 * menyegarkan tiap menit tidak menambah panggilan API.
 */
import { db } from "./supabase";
import { decryptThreadsToken } from "./threads-token";

const GRAPH = "https://graph.threads.net/v1.0";
const FETCH_TIMEOUT_MS = 8_000;
const INSIGHTS_SCOPE = "threads_manage_insights";
export const LIVE_TTL_MS = 60_000;
/** Data hari ini yang lebih tua dari TTL tapi di bawah batas ini langsung dipakai, lalu disegarkan di latar. */
export const LIVE_STALE_MAX_MS = 10 * 60_000;
// Batas laju Threads berlaku per token (per akun), jadi akun berbeda aman diambil paralel.
// 64 = ±60 akun dalam satu putaran; dasbor default (7 hari) ikut menunggu angka hari ini.
const CONCURRENCY = 64;
/** Batas postingan hari ini yang diambil metriknya (1 panggilan/postingan): total views & postingan terpopuler. */
const MAX_LIVE_POSTS = 300;
const TEXT_MAX = 500;
const ID_CHUNK = 100;

export interface LivePost {
  id: string;
  accountId: string;
  mediaType: string;
  text: string;
  permalink: string | null;
  postedAt: Date;
}

export interface LiveAccount {
  accountId: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  followers: number | null;
  posts: LivePost[];
}

export interface LivePostMetrics {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
}

export interface LiveToday {
  /** Hanya akun yang berhasil diambil. */
  accounts: Map<string, LiveAccount>;
  /** Akun yang tidak bisa diambil (tanpa izin insights, token rusak, galat API). */
  failed: number;
  fetchedAt: Date;
}

interface Insight {
  name?: string;
  total_value?: { value?: number };
  values?: { value?: number }[];
}

/** Jumlahkan satu metrik; sama dengan `insightMetric` di worker auto-suka. */
function metric(data: Insight[] | undefined, name: string): number {
  const item = (data ?? []).find((d) => d?.name === name);
  if (!item) return 0;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (item.total_value) return num(item.total_value.value);
  if (Array.isArray(item.values)) return item.values.reduce((s, v) => s + num(v?.value), 0);
  return 0;
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !body) throw new Error(body?.error?.message || `Threads membalas ${res.status}`);
  return body;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

interface TokenRow {
  id: string;
  threadsUserId: string;
  accessToken: string | null;
  scopes: string[] | null;
  needsReconnect: boolean;
}

/** Token terbuka akun yang terakhir diambil, dipakai ulang untuk metrik postingan (tidak pernah dikirim ke klien). */
const liveTokens = new Map<string, string>();

async function fetchAccount(row: TokenRow, dayStart: Date, now: Date): Promise<LiveAccount | null> {
  if (row.needsReconnect || !row.accessToken || !(row.scopes ?? []).includes(INSIGHTS_SCOPE)) return null;
  try {
    const token = decryptThreadsToken(row.accessToken);
    liveTokens.set(row.id, token);
    const since = String(Math.floor(dayStart.getTime() / 1000));
    const [ins, fol, posts] = await Promise.all([
      graph<{ data?: Insight[] }>(`${row.threadsUserId}/threads_insights`, {
        metric: "views,likes,replies,reposts,quotes",
        since,
        until: String(Math.floor(now.getTime() / 1000)),
        access_token: token,
      }),
      graph<{ data?: Insight[] }>(`${row.threadsUserId}/threads_insights`, {
        metric: "followers_count",
        access_token: token,
      }),
      graph<{ data?: { id?: string; media_type?: string; text?: string; permalink?: string; timestamp?: string }[] }>(
        `${row.threadsUserId}/threads`,
        { fields: "id,media_type,text,permalink,timestamp", since, limit: "100", access_token: token }
      ),
    ]);
    return {
      accountId: row.id,
      views: metric(ins.data, "views"),
      likes: metric(ins.data, "likes"),
      replies: metric(ins.data, "replies"),
      reposts: metric(ins.data, "reposts"),
      quotes: metric(ins.data, "quotes"),
      followers: fol.data?.some((d) => d.name === "followers_count") ? metric(fol.data, "followers_count") : null,
      posts: (posts.data ?? [])
        // Repost milik orang lain tidak punya insights dan bukan postingan akun ini.
        .filter((p) => p.id && p.timestamp && p.media_type !== "REPOST_FACADE")
        .map((p) => ({
          id: p.id!,
          accountId: row.id,
          mediaType: p.media_type || "TEXT_POST",
          text: (p.text || "").slice(0, TEXT_MAX),
          permalink: p.permalink || null,
          postedAt: new Date(p.timestamp!),
        }))
        .filter((p) => p.postedAt.getTime() >= dayStart.getTime()),
    };
  } catch (err) {
    console.warn(`[threads-live] ${row.id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/*
 * Cache per akun: { hari, waktu ambil, janji hasil, sedang disegarkan }. Galat ikut di-cache supaya tidak diulang
 * tiap permintaan.
 */
const accountCache = new Map<
  string,
  { day: number; at: number; value: Promise<LiveAccount | null>; refreshing?: boolean }
>();

/**
 * Angka hari ini (sejak `dayStart`, tengah malam WIB dalam UTC) untuk akun-akun `ids`. Entri yang lewat TTL tapi
 * di bawah LIVE_STALE_MAX_MS langsung dikembalikan dan disegarkan di latar, jadi hanya pembukaan pertama yang menunggu.
 */
export async function fetchLiveToday(ids: string[], dayStart: Date, now = new Date()): Promise<LiveToday> {
  const day = dayStart.getTime();
  const age = (id: string) => {
    const c = accountCache.get(id);
    return c && c.day === day ? now.getTime() - c.at : Infinity;
  };
  const stale = ids.filter((id) => age(id) >= LIVE_TTL_MS && !accountCache.get(id)?.refreshing);
  // Masih layak tampil: tetap disajikan, hasil penyegaran menggantikannya setelah selesai.
  const background = new Set(stale.filter((id) => age(id) < LIVE_STALE_MAX_MS));

  if (stale.length) {
    // Satu janji untuk seluruh batch; tiap akun mendapat potongannya sendiri.
    const batch = (async () => {
      const rows: TokenRow[] = [];
      for (let i = 0; i < stale.length; i += ID_CHUNK) {
        const { data, error } = await db()
          .from("ThreadsAccount")
          .select("id, threadsUserId, accessToken, scopes, needsReconnect")
          .in("id", stale.slice(i, i + ID_CHUNK));
        if (error) throw new Error(`Supabase: ${error.message}`);
        rows.push(...((data ?? []) as TokenRow[]));
      }
      const results = await mapLimit(rows, CONCURRENCY, (r) => fetchAccount(r, dayStart, now));
      return new Map(results.filter((r): r is LiveAccount => r !== null).map((r) => [r.accountId, r]));
    })();
    for (const id of stale) {
      const value = batch.then((m) => m.get(id) ?? null);
      const entry = { day, at: now.getTime(), value };
      if (background.has(id)) {
        accountCache.get(id)!.refreshing = true;
        void value.then(() => accountCache.set(id, entry), () => undefined);
      } else {
        accountCache.set(id, entry);
      }
    }
    // Galat database: lepas dari cache supaya permintaan berikutnya mencoba lagi (yang lama tetap disajikan).
    batch.catch(() =>
      stale.forEach((id) => {
        const c = accountCache.get(id);
        if (!c) return;
        if (background.has(id)) c.refreshing = false;
        else accountCache.delete(id);
      })
    );
  }

  const results = await Promise.all(ids.map((id) => accountCache.get(id)!.value));
  const accounts = new Map<string, LiveAccount>();
  let failed = 0;
  results.forEach((r) => (r ? accounts.set(r.accountId, r) : failed++));
  const oldest = Math.min(...ids.map((id) => accountCache.get(id)?.at ?? now.getTime()), now.getTime());
  return { accounts, failed, fetchedAt: new Date(oldest) };
}

/**
 * Insights level akun untuk hari yang sedang berjalan sering masih 0 untuk suka/balasan/repost (Threads baru
 * menghitungnya belakangan), padahal insights postingan sudah terisi. Interaksi pada postingan yang terbit hari ini
 * pasti terjadi hari ini, jadi jumlahnya batas bawah yang jujur: pakai yang lebih besar. Penayangan tetap level akun.
 */
export function withPostFloor(account: LiveAccount, metrics: Map<string, LivePostMetrics>): LiveAccount {
  let likes = 0;
  let replies = 0;
  let reposts = 0;
  for (const p of account.posts) {
    const m = metrics.get(p.id);
    if (!m) continue;
    likes += m.likes;
    replies += m.replies;
    reposts += m.reposts;
  }
  return {
    ...account,
    likes: Math.max(account.likes, likes),
    replies: Math.max(account.replies, replies),
    reposts: Math.max(account.reposts, reposts),
  };
}

/* Metrik postingan hari ini: total views, "Postingan terpopuler", dan batas bawah interaksi hari ini. */
const postCache = new Map<string, { at: number; value: Promise<LivePostMetrics | null> }>();

/** Metrik postingan hari ini; panggil setelah `fetchLiveToday` (token akunnya dipakai ulang). */
export async function livePostMetrics(posts: LivePost[], now = new Date()): Promise<Map<string, LivePostMetrics>> {
  // Postingan paling awal diutamakan: waktunya paling lama untuk mengumpulkan penayangan.
  const picked = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime()).slice(0, MAX_LIVE_POSTS);
  const values = await mapLimit(picked, CONCURRENCY, (p): Promise<LivePostMetrics | null> => {
    const c = postCache.get(p.id);
    if (c && now.getTime() - c.at < LIVE_TTL_MS) return c.value;
    // Lewat TTL tapi masih segar: sajikan yang lama, segarkan di latar (hasil baru dipakai permintaan berikutnya).
    if (c && now.getTime() - c.at < LIVE_STALE_MAX_MS) {
      void fetchPostMetrics(p, now);
      return c.value;
    }
    return fetchPostMetrics(p, now);
  });

  // Buang entri kedaluwarsa supaya cache tidak tumbuh terus.
  for (const [id, c] of postCache) if (now.getTime() - c.at >= LIVE_STALE_MAX_MS) postCache.delete(id);

  const out = new Map<string, LivePostMetrics>();
  picked.forEach((p, i) => values[i] && out.set(p.id, values[i]!));
  return out;
}

const postRefreshing = new Set<string>();

/** Ambil metrik satu postingan dan simpan ke cache (penyegaran ganda untuk postingan yang sama digabung). */
function fetchPostMetrics(p: LivePost, now: Date): Promise<LivePostMetrics | null> {
  const cached = postCache.get(p.id);
  if (postRefreshing.has(p.id) && cached) return cached.value;
  const token = liveTokens.get(p.accountId);
  if (!token) return Promise.resolve(null);
  postRefreshing.add(p.id);
  const value = graph<{ data?: Insight[] }>(`${p.id}/insights`, {
    metric: "views,likes,replies,reposts",
    access_token: token,
  })
    .then((res) => ({
      views: metric(res.data, "views"),
      likes: metric(res.data, "likes"),
      replies: metric(res.data, "replies"),
      reposts: metric(res.data, "reposts"),
    }))
    .catch(() => null)
    .finally(() => postRefreshing.delete(p.id));
  // Penyegaran latar: entri lama tetap dipakai sampai yang baru selesai.
  if (cached) void value.then(() => postCache.set(p.id, { at: now.getTime(), value }));
  else postCache.set(p.id, { at: now.getTime(), value });
  return value;
}
