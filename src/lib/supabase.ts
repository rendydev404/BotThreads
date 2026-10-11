import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Akses database lewat Supabase REST memakai service role key.
 * Key ini melewati RLS, jadi HANYA boleh dipakai di server (API route,
 * proxy, server component). Jangan pernah diberi prefix NEXT_PUBLIC_.
 * Agregasi (SUM/GROUP BY) dikerjakan fungsi SQL di supabase/setup.sql.
 */

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur");
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/**
 * Tunggu query Supabase; lempar error bila gagal agar perilakunya sama seperti Prisma.
 * Tipe hasil ditentukan pemanggil (tanpa tipe skema, supabase-js menebak relasi
 * many-to-one sebagai array, padahal runtime-nya objek).
 */
export async function must<T>(query: PromiseLike<Result>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Supabase: ${error.message}${error.code ? ` (${error.code})` : ""}`);
  return data as T;
}

/** Panggil fungsi SQL (RPC). Argumen undefined dibuang supaya default NULL di SQL berlaku. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  return must<T>(db().rpc(fn, clean));
}

/** Date ➜ "YYYY-MM-DD" untuk kolom/parameter `date`. */
export const sqlDate = (d: Date) => d.toISOString().slice(0, 10);

/** Date ➜ literal `timestamp` (tanpa zona, UTC) seperti yang disimpan Prisma. */
export const sqlTs = (d: Date) => d.toISOString().replace("Z", "");

/**
 * Nilai `timestamp without time zone` / `date` dari REST ➜ Date (UTC).
 * REST mengembalikan "2026-01-01T10:00:00" tanpa zona; tanpa "Z" JavaScript
 * akan menganggapnya waktu lokal.
 */
export function toDate(v: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`);
}

export function toDateOrNull(v: string | null | undefined): Date | null {
  return v ? toDate(v) : null;
}

/** Nilai untuk kolom @updatedAt / @default(now()) yang dulu diisi otomatis oleh Prisma. */
export const nowTs = () => sqlTs(new Date());

/** Escape karakter wildcard untuk pola LIKE/ILIKE. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ---------- Tipe hasil fungsi SQL (supabase/setup.sql) ----------

export interface DailyByDate {
  date: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  followers: number;
  followers_count: number;
}

export interface DailyByAccount {
  threadsAccountId: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface LatestFollowers {
  threadsAccountId: string;
  followers: number;
  date: string;
}

export interface PostsByAccount {
  threadsAccountId: string;
  posts: number;
}

export interface PostsByMedia {
  mediaType: string;
  posts: number;
  avg_views: number;
  views: number;
  likes: number;
  replies: number;
}

interface DailyArgs {
  from?: Date;
  to?: Date;
  ids?: string[];
}

interface PostArgs {
  from?: Date; // inklusif
  to?: Date; // eksklusif
  ids?: string[];
}

const dailyArgs = (a: DailyArgs) => ({
  p_from: a.from ? sqlDate(a.from) : undefined,
  p_to: a.to ? sqlDate(a.to) : undefined,
  p_ids: a.ids,
});

const postArgs = (a: PostArgs) => ({
  p_from: a.from ? sqlTs(a.from) : undefined,
  p_to: a.to ? sqlTs(a.to) : undefined,
  p_ids: a.ids,
});

export const agg = {
  dailyByDate: (a: DailyArgs = {}) => rpc<DailyByDate[]>("dash_daily_by_date", dailyArgs(a)),
  dailyByAccount: (a: DailyArgs = {}) =>
    rpc<DailyByAccount[]>("dash_daily_by_account", dailyArgs(a)),
  dailyMaxDate: async (ids?: string[]) => {
    const v = await rpc<string | null>("dash_daily_max_date", { p_ids: ids });
    return v ? toDate(v) : null;
  },
  latestFollowers: (a: { to?: Date; ids?: string[] } = {}) =>
    rpc<LatestFollowers[]>("dash_latest_followers", {
      p_to: a.to ? sqlDate(a.to) : undefined,
      p_ids: a.ids,
    }),
  postsByAccount: (a: PostArgs = {}) => rpc<PostsByAccount[]>("dash_posts_by_account", postArgs(a)),
  postsByMedia: (a: PostArgs = {}) => rpc<PostsByMedia[]>("dash_posts_by_media", postArgs(a)),
};
