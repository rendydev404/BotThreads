/**
 * "Viral di Threads": posting publik terpopuler di Threads untuk topik yang sedang naik.
 *
 * Threads tidak punya API daftar topik tren. Yang resmi tersedia hanyalah pencarian kata kunci
 * (`GET /keyword_search`, `search_type=TOP` = paling populer). Jadi topik diambil dari tren pencarian
 * Indonesia (radar-sources.ts), lalu untuk tiap topik dicari posting Threads paling populer.
 *
 * Pencarian publik butuh izin `threads_keyword_search` yang sudah lolos App Review Meta. Tanpa itu,
 * Threads hanya mencari di posting milik akun pemegang token; hasil seperti itu bukan "viral" sehingga
 * TIDAK disimpan (lihat `searchTopPosts`).
 */
import { DEFAULT_BANNED_TERMS, bannedHits } from "./autopilot-gate";
import type { SignalDraft, TrendItem } from "./radar-sources";
import { threadsAuthorFromUrl } from "./radar-types";
import { HARD_NEWS_TERMS, cleanExternal, isUsableTrend, trendScore } from "./radar-sources";
import { wibDayKey } from "./scheduling";
import { db } from "./supabase";
import { decryptThreadsToken } from "./threads-token";

const GRAPH = "https://graph.threads.net/v1.0";
const FETCH_TIMEOUT_MS = 10_000;
/** Topik teratas yang dicari tiap putaran riset (1 panggilan API per topik). */
export const VIRAL_TOPICS = 8;
/** Posting yang disimpan per topik. */
export const VIRAL_POSTS_PER_TOPIC = 3;
const VIRAL_TTL_MS = 48 * 60 * 60 * 1000;
const SEARCH_SCOPE = "threads_keyword_search";

export interface ThreadsPost {
  id: string;
  username: string;
  text: string;
  permalink: string | null;
  timestamp: string | null;
  /** Hanya terisi bila diminta (`withReplyFlag`): posting ini balasan, bukan postingan utama. */
  isReply?: boolean;
}

export interface SearchToken {
  username: string;
  token: string;
}

/**
 * Token untuk pencarian tren otomatis: HANYA akun Threads milik BotThreads yang ditunjuk
 * `THREADS_SEARCH_USERNAME`. Hasilnya dilihat semua workspace, jadi token akun pelanggan tidak boleh dipakai
 * di sini (pelanggan memakai tokennya sendiri lewat panel Cari di Threads). Tanpa env ini tidak ada pencarian.
 */
export async function loadSearchTokens(limit = 3): Promise<SearchToken[]> {
  const preferred = process.env.THREADS_SEARCH_USERNAME?.trim().toLowerCase() || null;
  if (!preferred) return [];
  const { data, error } = await db()
    .from("ThreadsAccount")
    .select("username, accessToken, scopes, needsReconnect")
    .eq("needsReconnect", false)
    .eq("username", preferred)
    .not("accessToken", "is", null)
    .limit(5);
  if (error) throw new Error(`Gagal memuat akun untuk pencarian Threads: ${error.message}`);
  const rows = ((data ?? []) as { username: string; accessToken: string; scopes: string[] | null }[]).filter(
    (r) => r.username.toLowerCase() === preferred && (r.scopes ?? []).includes(SEARCH_SCOPE)
  );
  const out: SearchToken[] = [];
  for (const r of rows) {
    try {
      out.push({ username: r.username.toLowerCase(), token: decryptThreadsToken(r.accessToken) });
    } catch {
      // Token yang tidak bisa dibuka (kunci lain) dilewati.
    }
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Posting paling populer untuk satu kata kunci. `publicSearch` = hasil memuat akun lain, artinya izin
 * pencarian publik sudah aktif. Bila semua hasil milik akun pemegang token, izin belum disetujui.
 */
export function searchTopPosts(keyword: string, auth: SearchToken): Promise<{ posts: ThreadsPost[]; publicSearch: boolean }> {
  return searchPosts(keyword, auth, "TOP");
}

export type SearchType = "TOP" | "RECENT";

/** `GET /keyword_search` dengan token satu akun. TOP = paling populer, RECENT = terbaru. */
export async function searchPosts(
  keyword: string,
  auth: SearchToken,
  searchType: SearchType,
  opts: { withReplyFlag?: boolean } = {}
): Promise<{ posts: ThreadsPost[]; publicSearch: boolean }> {
  const u = new URL(`${GRAPH}/keyword_search`);
  u.search = new URLSearchParams({
    q: keyword,
    search_type: searchType,
    fields: opts.withReplyFlag ? "id,username,text,permalink,timestamp,is_reply" : "id,username,text,permalink,timestamp",
    limit: "25",
    access_token: auth.token,
  }).toString();
  const res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { data?: (Partial<ThreadsPost> & { is_reply?: boolean })[]; error?: { message?: string } } | null;
  if (!res.ok || !body) throw new Error(body?.error?.message || `Pencarian Threads membalas ${res.status}`);
  const posts = (body.data ?? [])
    .filter((p): p is ThreadsPost & { is_reply?: boolean } => typeof p.id === "string" && typeof p.username === "string")
    .map(({ is_reply, ...p }) => ({
      ...p,
      username: p.username.toLowerCase(),
      text: p.text ?? "",
      permalink: p.permalink ?? null,
      timestamp: p.timestamp ?? null,
      ...(opts.withReplyFlag ? { isReply: is_reply === true } : {}),
    }));
  return { posts, publicSearch: posts.some((p) => p.username !== auth.username) };
}

/** Posting viral jadi draf sinyal global (berlaku untuk semua workspace), dengan saringan topik sensitif. */
export function viralToSignals(
  topic: TrendItem,
  posts: ThreadsPost[],
  totalTopics: number,
  now: Date,
  extraBanned: string[] = []
): SignalDraft[] {
  const day = wibDayKey(now);
  // Saringan yang sama dengan topik tren: kata terlarang bawaan + berita keras + larangan tambahan.
  const banned = [...DEFAULT_BANNED_TERMS, ...HARD_NEWS_TERMS, ...extraBanned];
  const base = trendScore(topic, totalTopics);
  return posts
    .map((p) => ({ ...p, text: cleanExternal(p.text, 400), permalink: threadsAuthorFromUrl(p.permalink) ? p.permalink : null }))
    // Tanpa permalink sah tidak ada cara membuka atau mengenali penulisnya: dilewati.
    .filter((p) => p.permalink && p.text.length >= 15 && bannedHits(p.text, banned).length === 0)
    .slice(0, VIRAL_POSTS_PER_TOPIC)
    .map((p, i) => ({
      workspaceId: null,
      source: "THREADS_SEARCH" as const,
      title: topic.keyword,
      summary: p.text,
      url: p.permalink,
      rank: topic.rank,
      // Urutan dari Threads (TOP) = popularitas; posting pertama sedikit lebih tinggi.
      score: Math.round(Math.max(0.3, base - i * 0.05) * 100) / 100,
      raw: { username: p.username, postedAt: p.timestamp, postId: p.id, keyword: topic.keyword },
      hash: `THREADS_SEARCH:${day}:${p.id}`,
      expiresAt: new Date(now.getTime() + VIRAL_TTL_MS).toISOString(),
    }));
}

/**
 * Satu putaran "Viral di Threads": topik teratas yang aman -> posting terpopuler tiap topik. Mengembalikan
 * draf sinyal; kosong bila belum ada token berizin atau izin pencarian publik belum disetujui Meta.
 */
export async function captureThreadsViral(
  trends: TrendItem[],
  now: Date,
  extraBanned: string[] = []
): Promise<{ signals: SignalDraft[]; status: "ok" | "no_token" | "not_approved" }> {
  const topics = trends.filter((t) => isUsableTrend(t, extraBanned)).slice(0, VIRAL_TOPICS);
  if (topics.length === 0) return { signals: [], status: "ok" };
  const tokens = await loadSearchTokens();
  if (tokens.length === 0) return { signals: [], status: "no_token" };

  const signals: SignalDraft[] = [];
  let publicSeen = false;
  for (const topic of topics) {
    // Coba token berikutnya bila satu gagal (mis. kedaluwarsa); satu topik gagal tidak menghentikan yang lain.
    for (const auth of tokens) {
      try {
        const { posts, publicSearch } = await searchTopPosts(topic.keyword, auth);
        if (publicSearch) {
          publicSeen = true;
          signals.push(...viralToSignals(topic, posts.filter((p) => p.username !== auth.username), trends.length, now, extraBanned));
        }
        break;
      } catch (err) {
        console.warn(`[radar] cari Threads "${topic.keyword}" @${auth.username}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return { signals, status: publicSeen ? "ok" : "not_approved" };
}

/* ------------------------------------------------------------------ cari langsung (Radar > Cari di Threads) */

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 100;
const SEARCH_TEXT_MAX = 500;

export interface AccountSearchResult {
  posts: ThreadsPost[];
  /** Semua hasil milik akun pencari: izin pencarian publik belum disetujui Meta (hasil hanya posting sendiri). */
  ownOnly: boolean;
  username: string;
}

/**
 * Pencarian kata kunci atas permintaan pemilik, dengan token akun Threads miliknya sendiri. Hasil hanya
 * ditampilkan (tidak disimpan, tidak dibalas). Pemanggil wajib memastikan akun ada dalam lingkup workspace.
 */
export async function searchAsAccount(
  accountId: string,
  query: string,
  searchType: SearchType
): Promise<{ ok: true; result: AccountSearchResult } | { ok: false; status: number; error: string }> {
  const { data, error } = await db()
    .from("ThreadsAccount")
    .select("username, accessToken, scopes, needsReconnect")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Gagal memuat akun Threads: ${error.message}`);
  const row = data as { username: string; accessToken: string | null; scopes: string[] | null; needsReconnect: boolean } | null;
  if (!row) return { ok: false, status: 404, error: "Akun Threads tidak ditemukan." };
  if (row.needsReconnect || !row.accessToken) return { ok: false, status: 409, error: "Akun Threads perlu dihubungkan ulang." };
  if (!(row.scopes ?? []).includes(SEARCH_SCOPE)) {
    return { ok: false, status: 409, error: "Akun ini belum memberi izin pencarian. Hubungkan ulang akun Threads-nya." };
  }
  let token: string;
  try {
    token = decryptThreadsToken(row.accessToken);
  } catch {
    return { ok: false, status: 409, error: "Akun Threads perlu dihubungkan ulang." };
  }
  const username = row.username.toLowerCase();
  const { posts, publicSearch } = await searchPosts(query, { username, token }, searchType);
  return {
    ok: true,
    result: {
      posts: posts.map((p) => ({ ...p, text: cleanExternal(p.text, SEARCH_TEXT_MAX) })),
      ownOnly: posts.length > 0 && !publicSearch,
      username,
    },
  };
}
