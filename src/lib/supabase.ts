import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isExcludedUsername } from "@/lib/account-visibility";
import { inScope } from "@/lib/tenant-scope";

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

// ---------- Akun yang dikecualikan dari dashboard (lihat account-visibility.ts) ----------

interface AccountScope {
  visibleIds: string[];
  excludedIds: string[];
}

interface AccountRef {
  id: string;
  username: string | null;
  workspaceId: string | null;
  /** Tenant dashboard: pemimpin kelompok workspace-nya, atau workspace itu sendiri. */
  tenantId: string | null;
}

/* ---------- Tenant: beberapa workspace auto-suka bisa dikelola sebagai satu tenant ---------- */

const TENANT_TTL_MS = 60_000;
let tenantCache: { at: number; map: Map<string, string> } | null = null;
let tenantPending: Promise<Map<string, string>> | null = null;

/**
 * Peta workspace -> tenant (tabel DashboardWorkspaceGroup, sql/005). Workspace yang tidak terdaftar
 * adalah tenant sendiri. Sebelum sql/005 dipasang petanya kosong.
 */
async function tenantMap(): Promise<Map<string, string>> {
  if (tenantCache && Date.now() - tenantCache.at < TENANT_TTL_MS) return tenantCache.map;
  tenantPending ??= rpc<{ workspaceId: string; groupId: string }[]>("dash_ap_tenant_map")
    .then((rows) => new Map(rows.map((r) => [r.workspaceId, r.groupId])))
    .catch((err: unknown) => {
      // Fungsi belum ada (skema autopilot belum dipasang): tanpa pengelompokan.
      if (err instanceof Error && /PGRST202|42883/.test(err.message)) return new Map<string, string>();
      throw err;
    })
    .then((map) => {
      tenantCache = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      tenantPending = null;
    });
  return tenantPending;
}

/** Buang cache peta tenant dan daftar akun (setelah super admin mengubah tautan sumber akun). */
export function forgetAccountCaches(): void {
  tenantCache = null;
  scopeCache = null;
}

/** Id tenant untuk sebuah workspace auto-suka (null tetap null). */
export async function tenantIdOf(workspaceId: string | null): Promise<string | null> {
  if (!workspaceId) return null;
  return (await tenantMap()).get(workspaceId) ?? workspaceId;
}

const SCOPE_TTL_MS = 60_000;
let scopeCache: { at: number; rows: AccountRef[] } | null = null;
let scopePending: Promise<AccountRef[]> | null = null;

/** Semua akun Threads (id, username, workspace); cache 60 detik, permintaan serentak digabung. */
async function allAccounts(): Promise<AccountRef[]> {
  if (scopeCache && Date.now() - scopeCache.at < SCOPE_TTL_MS) return scopeCache.rows;
  scopePending ??= Promise.all([
    must<Omit<AccountRef, "tenantId">[]>(db().from("ThreadsAccount").select("id, username, workspaceId")),
    tenantMap(),
  ])
    .then(([raw, tenants]) => {
      const rows = raw.map((r) => ({ ...r, tenantId: r.workspaceId ? tenants.get(r.workspaceId) ?? r.workspaceId : null }));
      scopeCache = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      scopePending = null;
    });
  return scopePending;
}

/**
 * Id akun yang tampil dan yang dikecualikan untuk permintaan ini. Akun dikecualikan bila username-nya
 * ada di daftar pengecualian ATAU berada di luar lingkup tenant pengguna (tenant/akun); keduanya
 * diperlakukan sama oleh seluruh query: tidak ikut agregasi, daftar, maupun konteks AI.
 */
export async function accountScope(): Promise<AccountScope> {
  const value: AccountScope = { visibleIds: [], excludedIds: [] };
  for (const r of await allAccounts()) {
    const visible = !isExcludedUsername(r.username) && inScope(r.id, r.tenantId);
    (visible ? value.visibleIds : value.excludedIds).push(r.id);
  }
  return value;
}

/** Saring baris ber-id akun menurut lingkup permintaan ini (untuk query yang membaca ThreadsAccount langsung). */
export async function onlyVisible<T extends { id: string }>(rows: T[]): Promise<T[]> {
  const visible = new Set((await accountScope()).visibleIds);
  return rows.filter((r) => visible.has(r.id));
}

/**
 * Id untuk parameter p_ids. Tanpa akun dikecualikan, perilaku lama dipertahankan
 * (undefined = tanpa filter); bila ada, "semua akun" berarti semua akun yang tampil.
 */
export async function scopedIds(ids?: string[]): Promise<string[] | undefined> {
  const { visibleIds, excludedIds } = await accountScope();
  if (!excludedIds.length) return ids;
  if (!ids) return visibleIds;
  const hidden = new Set(excludedIds);
  return ids.filter((id) => !hidden.has(id));
}

/** Filter PostgREST `not.in` untuk membuang baris milik akun yang dikecualikan. */
export async function excludedIdList(): Promise<string | null> {
  const { excludedIds } = await accountScope();
  return excludedIds.length ? `(${excludedIds.join(",")})` : null;
}

export const agg = {
  dailyByDate: async (a: DailyArgs = {}) =>
    rpc<DailyByDate[]>("dash_daily_by_date", dailyArgs({ ...a, ids: await scopedIds(a.ids) })),
  dailyByAccount: async (a: DailyArgs = {}) =>
    rpc<DailyByAccount[]>("dash_daily_by_account", dailyArgs({ ...a, ids: await scopedIds(a.ids) })),
  dailyMaxDate: async (ids?: string[]) => {
    const v = await rpc<string | null>("dash_daily_max_date", { p_ids: await scopedIds(ids) });
    return v ? toDate(v) : null;
  },
  latestFollowers: async (a: { to?: Date; ids?: string[] } = {}) =>
    rpc<LatestFollowers[]>("dash_latest_followers", {
      p_to: a.to ? sqlDate(a.to) : undefined,
      p_ids: await scopedIds(a.ids),
    }),
  postsByAccount: async (a: PostArgs = {}) =>
    rpc<PostsByAccount[]>("dash_posts_by_account", postArgs({ ...a, ids: await scopedIds(a.ids) })),
  postsByMedia: async (a: PostArgs = {}) =>
    rpc<PostsByMedia[]>("dash_posts_by_media", postArgs({ ...a, ids: await scopedIds(a.ids) })),
};

/** Alias dipakai modul penjadwalan: timestamp UTC dari database -> Date. */
export const utc = toDate;
export const utcOrNull = toDateOrNull;
