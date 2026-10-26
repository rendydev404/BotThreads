/**
 * Pengumpul metrik Threads milik dashboard (port dari threads-insights.service.ts worker auto-suka, supaya
 * dashboard tidak bergantung pada sistem lain). Dipanggil penjadwal tiap 5 menit lewat
 * /api/internal/insights/tick. Sekali sehari per akun (setelah 05.00 WIB); akun yang belum pernah diambil
 * langsung jalan:
 * - metrik akun per hari WIB -> ThreadsAccountDaily (hari yang belum ada diisi mundur s.d. BACKFILL_DAYS)
 * - followers saat ini -> baris hari kemarin
 * - postingan 30 hari terakhir + metriknya -> ThreadsPostStat
 *
 * Satu putaran berhenti mengambil akun baru setelah TICK_BUDGET_MS; sisanya diambil putaran berikutnya
 * (akun tetap "jatuh tempo" sampai insightsSyncedAt-nya terisi). Lease mencegah dua putaran serentak.
 * Tulisan dikirim per akun dalam beberapa upsert batch, bukan per baris.
 */
import { randomUUID } from "node:crypto";
import { acquireLease, releaseLease } from "./autopilot-store";
import { db, must, sqlTs, toDate } from "./supabase";
import { ThreadsApiError, accessTokenFor, type AccountRow } from "./threads-publisher";

const API = "https://graph.threads.net/v1.0";
const FETCH_TIMEOUT_MS = 15_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WIB_OFFSET = 7 * HOUR;
/** Jam WIB mulai pengambilan harian; data hari kemarin sudah lengkap di sisi Threads. */
const SYNC_HOUR_WIB = 5;
export const BACKFILL_DAYS = 30;
/** Hari terakhir yang selalu diambil ulang karena angkanya masih bisa bertambah. */
const REFRESH_RECENT_DAYS = 2;
const POST_WINDOW_DAYS = 30;
const ACCOUNT_CONCURRENCY = 3;
const MEDIA_CONCURRENCY = 4;
const TEXT_MAX = 500;
/** Batas halaman saat mengambil postingan sendiri (maks. ±400 postingan per sinkron). */
const MAX_OWN_POST_PAGES = 4;
const ID_CHUNK = 100;
export const INSIGHTS_SCOPE = "threads_manage_insights";
/** Setelah ini putaran tidak mengambil akun baru (route punya maxDuration 300 detik). */
const TICK_BUDGET_MS = 120_000;
const LEASE_NAME = "insights-tick";
const LEASE_MS = 5 * 60 * 1000;

const USER_METRICS = "views,likes,replies,reposts,quotes,clicks";
const MEDIA_METRICS = "views,likes,replies,reposts,quotes,shares";
const OWN_POST_FIELDS = "id,media_type,text,timestamp,permalink,is_quote_post";

/* ------------------------------------------------------------------ fungsi murni */

/** Tanggal WIB "YYYY-MM-DD". */
export function wibDateKey(at: Date): string {
  return new Date(at.getTime() + WIB_OFFSET).toISOString().slice(0, 10);
}

/** Tengah malam WIB untuk hari `at`, dalam UTC. */
export function wibMidnight(at: Date): Date {
  return new Date(Math.floor((at.getTime() + WIB_OFFSET) / DAY) * DAY - WIB_OFFSET);
}

/**
 * Perlu ambil ulang metrik postingan? Angka postingan Threads umumnya stabil setelah ±3 hari,
 * jadi postingan ≤ 3 hari diambil tiap hari dan 3–30 hari cukup seminggu sekali.
 */
export function needsMediaRefresh(postedAt: Date, metricsUpdatedAt: Date | null, now: Date): boolean {
  if (!metricsUpdatedAt) return true;
  const age = now.getTime() - postedAt.getTime();
  const since = now.getTime() - metricsUpdatedAt.getTime();
  return age <= 3 * DAY ? since >= 20 * HOUR : since >= 7 * DAY;
}

export interface KnownPostStat {
  mediaId: string;
  metricsUpdatedAt: Date | null;
  text: string | null;
  permalink: string | null;
  mediaType: string | null;
}

/**
 * Baris statistik yang dibuat worker lain sering belum berisi teks, permalink, atau jenis media asli.
 * Karena `listOwnPosts` sudah memuat ketiganya dari API Threads, baris ini wajib dilengkapi walau
 * `metricsUpdatedAt` belum lewat 20 jam.
 */
export function needsMetaFill(
  p: { text?: string; permalink?: string; media_type?: string },
  known: KnownPostStat | undefined
): boolean {
  if (!known) return true;
  const wantText = (p.text || "").slice(0, TEXT_MAX).trim();
  if (wantText && !(known.text ?? "").trim()) return true;
  if (p.permalink && !known.permalink) return true;
  const wantType = p.media_type || "TEXT_POST";
  if (known.mediaType !== wantType) return true;
  return false;
}

/** Akun sudah waktunya diambil hari ini? Yang belum pernah diambil langsung jalan. */
export function isSyncDue(insightsSyncedAt: Date | null, now: Date): boolean {
  if (!insightsSyncedAt) return true;
  const dueAt = wibMidnight(now).getTime() + SYNC_HOUR_WIB * HOUR;
  return now.getTime() >= dueAt && insightsSyncedAt.getTime() < dueAt;
}

interface Insight {
  name?: string;
  total_value?: { value?: number };
  link_total_values?: { value?: number }[];
  values?: { value?: number }[];
}

/**
 * Jumlahkan satu metrik dari respons insights. Bentuknya beda per metrik: `views` akun berupa
 * deret harian (`values`), `clicks` berupa `link_total_values`, sisanya `total_value`.
 */
export function insightMetric(data: Insight[] | undefined, name: string): number {
  const item = (data ?? []).find((d) => d?.name === name);
  if (!item) return 0;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (item.total_value) return num(item.total_value.value);
  if (Array.isArray(item.link_total_values)) return item.link_total_values.reduce((s, l) => s + num(l?.value), 0);
  if (Array.isArray(item.values)) return item.values.reduce((s, v) => s + num(v?.value), 0);
  return 0;
}

const isRateLimit = (e: ThreadsApiError) =>
  e.status === 429 || e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613;

export function friendlyInsightsError(err: unknown): string {
  if (err instanceof ThreadsApiError) {
    if (err.isAuthError) return "Token Threads tidak berlaku lagi. Hubungkan ulang akun.";
    if (err.code === 10 || err.code === 200 || /permission/i.test(err.message)) {
      return "Izin threads_manage_insights ditolak. Pastikan akun sudah jadi Threads Tester, lalu hubungkan ulang.";
    }
    if (isRateLimit(err)) return "Kena batas rate limit Threads. Dicoba lagi besok.";
  }
  return `Gagal ambil data: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
}

/* ------------------------------------------------------------------ Threads API */

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number } };
  if (!res.ok || body?.error) {
    const e = body?.error ?? {};
    throw new ThreadsApiError(e.error_user_msg || e.message || `Threads API error (${res.status})`, res.status, e.code);
  }
  return body;
}

const unix = (d: Date) => String(Math.floor(d.getTime() / 1000));

type DailyMetrics = { views: number; likes: number; replies: number; reposts: number; quotes: number; clicks: number };
type MediaMetrics = { views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number };
type OwnPost = { id?: string; media_type?: string; text?: string; timestamp?: string; permalink?: string; is_quote_post?: boolean };

async function userInsights(userId: string, token: string, since: Date, until: Date): Promise<DailyMetrics> {
  const q = new URLSearchParams({ metric: USER_METRICS, since: unix(since), until: unix(until), access_token: token });
  const { data } = await get<{ data?: Insight[] }>(`${API}/${userId}/threads_insights?${q}`);
  return {
    views: insightMetric(data, "views"),
    likes: insightMetric(data, "likes"),
    replies: insightMetric(data, "replies"),
    reposts: insightMetric(data, "reposts"),
    quotes: insightMetric(data, "quotes"),
    clicks: insightMetric(data, "clicks"),
  };
}

async function followersCount(userId: string, token: string): Promise<number> {
  const q = new URLSearchParams({ metric: "followers_count", access_token: token });
  const { data } = await get<{ data?: Insight[] }>(`${API}/${userId}/threads_insights?${q}`);
  return insightMetric(data, "followers_count");
}

async function listOwnPosts(userId: string, token: string, since: Date): Promise<OwnPost[]> {
  const out: OwnPost[] = [];
  let url: string | null = `${API}/${userId}/threads?${new URLSearchParams({
    fields: OWN_POST_FIELDS,
    since: unix(since),
    limit: "100",
    access_token: token,
  })}`;
  for (let page = 0; url && page < MAX_OWN_POST_PAGES; page++) {
    const res: { data?: OwnPost[]; paging?: { next?: string } } = await get(url);
    out.push(...(res.data ?? []));
    url = res.paging?.next ?? null;
  }
  return out;
}

async function mediaInsights(mediaId: string, token: string): Promise<MediaMetrics> {
  const q = new URLSearchParams({ metric: MEDIA_METRICS, access_token: token });
  const { data } = await get<{ data?: Insight[] }>(`${API}/${mediaId}/insights?${q}`);
  return {
    views: insightMetric(data, "views"),
    likes: insightMetric(data, "likes"),
    replies: insightMetric(data, "replies"),
    reposts: insightMetric(data, "reposts"),
    quotes: insightMetric(data, "quotes"),
    shares: insightMetric(data, "shares"),
  };
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

/* ------------------------------------------------------------------ sinkron satu akun */

type SyncAccount = AccountRow & { username: string | null; insightsSyncedAt: string | null };

async function syncDaily(account: SyncAccount, token: string, now: Date): Promise<number> {
  const today = wibMidnight(now);
  const oldestKey = wibDateKey(new Date(today.getTime() - BACKFILL_DAYS * DAY));
  const existing = await must<{ date: string }[]>(
    db().from("ThreadsAccountDaily").select("date").eq("threadsAccountId", account.id).gte("date", oldestKey)
  );
  const have = new Set(existing.map((d) => d.date.slice(0, 10)));

  const days: { key: string; start: Date }[] = [];
  for (let i = 1; i <= BACKFILL_DAYS; i++) {
    const start = new Date(today.getTime() - i * DAY);
    const key = wibDateKey(start);
    if (i > REFRESH_RECENT_DAYS && have.has(key)) continue;
    days.push({ key, start });
  }
  // Berurutan seperti worker: satu akun = satu token, jangan bebani batas lajunya.
  const rows = [];
  for (const d of days) {
    const m = await userInsights(account.threadsUserId, token, d.start, new Date(d.start.getTime() + DAY));
    rows.push({ threadsAccountId: account.id, date: d.key, ...m, updatedAt: sqlTs(now) });
  }
  if (rows.length) {
    await must(db().from("ThreadsAccountDaily").upsert(rows, { onConflict: "threadsAccountId,date" }));
  }

  const followers = await followersCount(account.threadsUserId, token);
  const yesterday = wibDateKey(new Date(today.getTime() - DAY));
  await must(
    db()
      .from("ThreadsAccountDaily")
      .update({ followers, updatedAt: sqlTs(now) })
      .eq("threadsAccountId", account.id)
      .eq("date", yesterday)
  );
  return days.length + 1;
}

async function syncPosts(account: SyncAccount, token: string, now: Date): Promise<number> {
  const posts = (await listOwnPosts(account.threadsUserId, token, new Date(now.getTime() - POST_WINDOW_DAYS * DAY)))
    // Repost milik orang lain tidak punya insights.
    .filter((p) => p.id && p.timestamp && p.media_type !== "REPOST_FACADE");
  let calls = 1;
  if (!posts.length) return calls;

  const known = new Map<string, KnownPostStat>();
  for (let i = 0; i < posts.length; i += ID_CHUNK) {
    const rows = await must<
      {
        mediaId: string;
        metricsUpdatedAt: string | null;
        text: string | null;
        permalink: string | null;
        mediaType: string | null;
      }[]
    >(
      db()
        .from("ThreadsPostStat")
        .select("mediaId, metricsUpdatedAt, text, permalink, mediaType")
        .in("mediaId", posts.slice(i, i + ID_CHUNK).map((p) => p.id!))
    );
    for (const r of rows) {
      known.set(r.mediaId, {
        mediaId: r.mediaId,
        metricsUpdatedAt: r.metricsUpdatedAt ? toDate(r.metricsUpdatedAt) : null,
        text: r.text,
        permalink: r.permalink,
        mediaType: r.mediaType,
      });
    }
  }
  const due = posts.filter((p) => needsMediaRefresh(new Date(p.timestamp!), known.get(p.id!)?.metricsUpdatedAt ?? null, now));
  const dueIds = new Set(due.map((p) => p.id!));
  const metaOnly = posts.filter((p) => !dueIds.has(p.id!) && needsMetaFill(p, known.get(p.id!)));
  if (!due.length && !metaOnly.length) return calls;

  const metrics = due.length
    ? await mapLimit(due, MEDIA_CONCURRENCY, async (p): Promise<MediaMetrics | null> => {
        try {
          return await mediaInsights(p.id!, token);
        } catch (err) {
          // Satu postingan gagal (mis. baru dihapus) tidak menggagalkan akun; galat izin tetap naik.
          if (err instanceof ThreadsApiError && (err.isAuthError || isRateLimit(err) || err.code === 10)) throw err;
          return null;
        }
      })
    : [];
  calls += due.length;

  // Hanya postingan yang baru diambil metriknya yang ditulis beserta kolom metrik. Bentuk baris harus
  // seragam per upsert, jadi yang metriknya gagal diambil atau hanya melengkapi metadata dikirim terpisah.
  const base = (p: OwnPost) => ({
    threadsAccountId: account.id,
    mediaId: p.id!,
    mediaType: p.media_type || "TEXT_POST",
    text: (p.text || "").slice(0, TEXT_MAX),
    permalink: p.permalink || null,
    isQuote: Boolean(p.is_quote_post),
    postedAt: sqlTs(new Date(p.timestamp!)),
    updatedAt: sqlTs(now),
  });
  const withMetrics = due.flatMap((p, i) => (metrics[i] ? [{ ...base(p), ...metrics[i]!, metricsUpdatedAt: sqlTs(now) }] : []));
  const without = [...due.flatMap((p, i) => (metrics[i] ? [] : [base(p)])), ...metaOnly.map(base)];
  for (const rows of [withMetrics, without]) {
    if (rows.length) await must(db().from("ThreadsPostStat").upsert(rows, { onConflict: "mediaId" }));
  }
  return calls;
}

async function markSynced(id: string, error: string | null) {
  await must(
    db()
      .from("ThreadsAccount")
      .update({ insightsSyncedAt: sqlTs(new Date()), insightsError: error })
      .eq("id", id)
  );
}

/** Ambil metrik satu akun. Hasil (sukses/galat) dicatat di ThreadsAccount. */
export async function syncAccountInsights(account: SyncAccount, now = new Date()): Promise<{ ok: boolean; calls: number; error?: string }> {
  const started = Date.now();
  let calls = 0;
  try {
    // Token diperpanjang di sini bila hampir habis, jadi akun yang jarang memposting tetap hidup.
    const token = await accessTokenFor(account, now);
    if (!token) throw new ThreadsApiError("Token tidak berlaku", 401, 190);
    calls += await syncDaily(account, token, now);
    calls += await syncPosts(account, token, now);
    // Waktu selesai (bukan mulai), supaya dashboard tidak menganggap akun masih diambil.
    await markSynced(account.id, null);
    console.log(`[threads-insights] @${account.username}: ${calls} panggilan API, ${Date.now() - started} ms`);
    return { ok: true, calls };
  } catch (err) {
    const error = friendlyInsightsError(err);
    // Dicatat sebagai sudah dicoba hari ini supaya tidak diulang tiap putaran.
    await markSynced(account.id, error).catch(() => undefined);
    console.warn(`[threads-insights] @${account.username}: ${error}`);
    return { ok: false, calls, error };
  }
}

const ACCOUNT_COLUMNS = "id, threadsUserId, username, accessToken, accessExpiresAt, needsReconnect, updatedAt, insightsSyncedAt";

/**
 * Sinkron satu akun sekarang juga, tanpa menunggu jadwal harian (agen onboarding). Mengembalikan jumlah
 * postingan akun yang tersimpan setelah sinkron; galat izin dicatat di akun dan dikembalikan.
 */
export async function syncInsightsFor(accountId: string, now = new Date()): Promise<{ ok: boolean; posts: number; error?: string }> {
  const [account] = await must<SyncAccount[]>(db().from("ThreadsAccount").select(ACCOUNT_COLUMNS).eq("id", accountId).limit(1));
  if (!account?.accessToken) return { ok: false, posts: 0, error: "Akun tidak ditemukan atau belum punya token." };
  const res = await syncAccountInsights(account, now);
  const { count } = await db().from("ThreadsPostStat").select("id", { count: "exact", head: true }).eq("threadsAccountId", accountId);
  return { ok: res.ok, posts: count ?? 0, error: res.error };
}

/* ------------------------------------------------------------------ putaran */

export interface InsightsTickResult {
  dilewati?: "lease";
  jatuhTempo: number;
  diproses: number;
  ok: number;
  gagal: number;
  panggilanApi: number;
  durasiMs: number;
}

/** Satu putaran: akun yang jatuh tempo diambil sampai batas waktu; sisanya putaran berikutnya. */
export async function runInsightsTick(now = new Date()): Promise<InsightsTickResult> {
  const started = Date.now();
  const holder = randomUUID();
  const empty = { jatuhTempo: 0, diproses: 0, ok: 0, gagal: 0, panggilanApi: 0 };
  if (!(await acquireLease(LEASE_NAME, holder, now, new Date(now.getTime() + LEASE_MS)))) {
    return { dilewati: "lease", ...empty, durasiMs: Date.now() - started };
  }
  try {
    const accounts = await must<SyncAccount[]>(
      db()
        .from("ThreadsAccount")
        .select(ACCOUNT_COLUMNS)
        .eq("needsReconnect", false)
        .contains("scopes", [INSIGHTS_SCOPE])
        .order("createdAt", { ascending: true })
    );
    const due = accounts.filter((a) => a.accessToken && isSyncDue(a.insightsSyncedAt ? toDate(a.insightsSyncedAt) : null, now));

    let next = 0;
    const results: { ok: boolean; calls: number }[] = [];
    await Promise.all(
      Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, due.length) }, async () => {
        while (next < due.length && Date.now() - started < TICK_BUDGET_MS) {
          results.push(await syncAccountInsights(due[next++], now));
        }
      })
    );
    return {
      jatuhTempo: due.length,
      diproses: results.length,
      ok: results.filter((r) => r.ok).length,
      gagal: results.filter((r) => !r.ok).length,
      panggilanApi: results.reduce((s, r) => s + r.calls, 0),
      durasiMs: Date.now() - started,
    };
  } finally {
    await releaseLease(LEASE_NAME, holder).catch(() => undefined);
  }
}
