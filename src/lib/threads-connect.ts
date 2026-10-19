/**
 * Penghubungan akun Threads mandiri (self-service) untuk workspace penyewa.
 *
 * Dua jalan, hasilnya sama:
 * 1. OAuth resmi Meta Threads (`threads.net/oauth/authorize` ➜ token long-lived 60 hari).
 * 2. Tempel Access Token Threads (diverifikasi ke `graph.threads.net/v1.0/me`).
 *
 * Akun disimpan persis seperti worker auto-suka menyimpannya: token terenkripsi AES-256-GCM dengan
 * kunci yang sama (lihat threads-token.ts), lalu dipetakan ke "Outlet" + "SocialAccount" platform
 * THREADS. Tanpa pemetaan itu worker tidak bisa memposting dan dashboard menandai akun "belum
 * dipetakan". Worker juga yang memperpanjang token sebelum kedaluwarsa.
 *
 * Setiap akun BARU memeriksa kuota `maxAkun` paket workspace; menghubungkan ulang akun yang sama tidak.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getRawIntegrations } from "./integrations";
import { planLimits } from "./plan";
import { forgetPublishAccounts } from "./publish-accounts";
import { forgetMembership } from "./request-ctx";
import { db, forgetAccountCaches, nowTs, rpc, sqlTs } from "./supabase";
import { encryptThreadsToken, tokenKeyConfigured, tokenKeyMatches } from "./threads-token";
import type { Failure } from "./threads-publish";

const GRAPH = "https://graph.threads.net";
const FETCH_TIMEOUT_MS = 10_000;
/** Umur token long-lived Threads bila API tidak menyebutkan `expires_in`. */
const LONG_LIVED_SECONDS = 60 * 86_400;

/** Cookie lama berisi `state` OAuth Threads; kini hanya dihapus saat callback (state sudah bertanda tangan). */
export const THREADS_OAUTH_COOKIE = "th_oauth";
/** Umur `state` OAuth Threads: login di halaman Threads harus selesai dalam waktu ini. */
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

export interface ThreadsOAuthState {
  /** Pengguna yang memulai. */
  userId: string;
  /** Workspace yang akan menerima akun. */
  workspaceId: string;
}

const stateKey = (): string => {
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET belum diisi.");
  return secret;
};
const stateSig = (payload: string): string => createHmac("sha256", stateKey()).update(`threads-oauth:${payload}`).digest("base64url");

/**
 * `state` OAuth bertanda tangan (HMAC AUTH_SECRET) berisi pengguna + workspace + masa berlaku. Di HP, halaman
 * izin Threads sering terbuka di aplikasi Threads atau browser lain, sehingga callback datang tanpa cookie dari
 * browser yang memulai; dengan state bertanda tangan callback tetap tahu siapa dan ke workspace mana akunnya.
 */
export function signThreadsOAuthState(s: ThreadsOAuthState, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: s.userId, w: s.workspaceId, e: now + OAUTH_STATE_TTL_MS, n: randomBytes(9).toString("base64url") })
  ).toString("base64url");
  return `${payload}.${stateSig(payload)}`;
}

/** Kebalikan `signThreadsOAuthState`; null bila tanda tangan salah, rusak, atau kedaluwarsa. */
export function verifyThreadsOAuthState(raw: string | null, now = Date.now()): ThreadsOAuthState | null {
  if (!raw || raw.length > 600) return null;
  const [payload, sig, extra] = raw.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(stateSig(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; w?: unknown; e?: unknown };
    if (typeof v.u !== "string" || typeof v.w !== "string" || typeof v.e !== "number" || v.e < now) return null;
    return { userId: v.u, workspaceId: v.w };
  } catch {
    return null;
  }
}

/** Izin yang diminta saat OAuth (sama dengan worker auto-suka). */
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
  "threads_read_replies",
  "threads_manage_replies",
  // Pencarian kata kunci (Tren Viral di Radar); hasil publik butuh App Review dari Meta.
  "threads_keyword_search",
];

export interface ConnectedThreadsAccountDTO {
  id: string;
  threadsUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  needsReconnect: boolean;
  accessExpiresAt: string;
  scopes: string[];
  connectedAt: string | null;
  autopilotMode: string;
  postsPerDay: number;
}

export interface WorkspaceThreadsAccountsResponse {
  success: true;
  accounts: ConnectedThreadsAccountDTO[];
  quota: {
    used: number;
    max: number | null;
    planNama: string | null;
    expired: boolean;
  };
  /** Tombol "Login dengan Threads" bisa dipakai (App ID + Secret terisi). */
  oauthConfigured: boolean;
  /** Server siap menyimpan token (TOKEN_ENCRYPTION_KEY terisi). */
  connectReady: boolean;
}

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

const NO_KEY =
  "Server belum siap menyimpan akun Threads: TOKEN_ENCRYPTION_KEY belum diisi. Hubungi admin platform.";

/** Workspace auto-suka yang tergabung ke tenant dashboard ini (tenant itu sendiri + anggota kelompoknya). */
async function linkedWorkspaces(workspaceId: string): Promise<Set<string>> {
  const rows = await rpc<{ workspaceId: string; groupId: string }[]>("dash_ap_tenant_map").catch(() => []);
  const set = new Set<string>([workspaceId]);
  for (const r of rows) if (r.groupId === workspaceId) set.add(r.workspaceId);
  return set;
}

/** Daftar semua akun Threads milik workspace aktif beserta pemakaian kuota paketnya. */
export async function listWorkspaceThreadsAccounts(workspaceId: string): Promise<WorkspaceThreadsAccountsResponse> {
  const [limits, integrations, linked, configs] = await Promise.all([
    planLimits(workspaceId),
    getRawIntegrations(),
    linkedWorkspaces(workspaceId),
    rpc<{ accountId: string; mode: string; postsPerDay: number }[]>("dash_ap_configs", { p_ws: workspaceId }).catch(() => []),
  ]);

  const { data: rawAccounts } = await db()
    .from("ThreadsAccount")
    .select("id, threadsUserId, username, displayName, avatarUrl, needsReconnect, accessExpiresAt, scopes, connectedAt")
    .in("workspaceId", [...linked])
    .order("displayName", { ascending: true });

  const cfgMap = new Map(configs.map((c) => [c.accountId, c]));
  const asIso = (v: unknown): string | null => (typeof v === "string" && v ? `${v.replace(/Z$/, "")}Z` : null);

  const accounts: ConnectedThreadsAccountDTO[] = ((rawAccounts ?? []) as Record<string, unknown>[]).map((r) => {
    const id = String(r.id);
    const cfg = cfgMap.get(id);
    return {
      id,
      threadsUserId: String(r.threadsUserId ?? ""),
      username: String(r.username ?? ""),
      displayName: String(r.displayName ?? r.username ?? "Akun Threads"),
      avatarUrl: typeof r.avatarUrl === "string" ? r.avatarUrl : null,
      needsReconnect: Boolean(r.needsReconnect),
      accessExpiresAt: asIso(r.accessExpiresAt) ?? new Date(0).toISOString(),
      scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
      connectedAt: asIso(r.connectedAt),
      autopilotMode: cfg?.mode ?? "MATI",
      postsPerDay: cfg?.postsPerDay ?? 3,
    };
  });

  return {
    success: true,
    accounts,
    quota: {
      used: accounts.length,
      max: limits.plan?.maxAkun ?? null,
      planNama: limits.plan?.nama ?? null,
      expired: limits.kedaluwarsa,
    },
    oauthConfigured: !!(integrations.threadsOauth.enabled && integrations.threadsOauth.appId && integrations.threadsOauth.appSecret),
    connectReady: tokenKeyConfigured(),
  };
}

/** Status kunci enkripsi untuk panel super admin: terisi? cocok dengan token yang disimpan worker? */
export async function threadsTokenKeyStatus(): Promise<{ configured: boolean; matchesWorker: boolean | null }> {
  if (!tokenKeyConfigured()) return { configured: false, matchesWorker: null };
  const { data } = await db()
    .from("ThreadsAccount")
    .select("accessToken")
    .like("accessToken", "%.%.%")
    .order("updatedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sample = (data as { accessToken?: string } | null)?.accessToken;
  return { configured: true, matchesWorker: sample ? tokenKeyMatches(sample) : null };
}

/** Pastikan baris "Workspace" (milik auto-suka) dengan id tenant ada, demi integritas FK. */
async function ensureWorkspaceRow(workspaceId: string): Promise<void> {
  const { data: existing } = await db().from("Workspace").select("id").eq("id", workspaceId).maybeSingle();
  if (existing) return;

  const settings = await rpc<{ namaBrand: string | null } | null>("dash_mu_settings_get", { p_workspace: workspaceId }).catch(() => null);
  const nama = settings?.namaBrand?.trim() || "Workspace";
  const slug = `${nama.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "workspace"}-${workspaceId.slice(0, 8)}`;
  const stamp = nowTs();
  const { error } = await db().from("Workspace").insert({
    id: workspaceId,
    nama,
    slug,
    postizEnabled: false,
    tiktokDirect: false,
    createdAt: stamp,
    updatedAt: stamp,
  });
  // Balapan dengan permintaan lain yang membuat baris yang sama: abaikan duplikat.
  if (error && !/duplicate|23505/i.test(error.message)) throw new Error(`Gagal menyiapkan workspace: ${error.message}`);
}

/**
 * Pastikan akun punya "cabang" tersembunyi (Outlet) + penghubung (SocialAccount, THREADS) supaya worker
 * penerbit auto-suka bisa memposting lewatnya. Tabel itu milik worker dan tidak bisa ditulis service_role,
 * jadi lewat fungsi SECURITY DEFINER yang sempit (sql/016_threads_publish_map.sql). Idempoten.
 */
async function ensurePublishMapping(accountId: string, now = new Date()): Promise<void> {
  let res: { status: string };
  try {
    res = await rpc<{ status: string }>("dash_tc_publish_map", { p_account: accountId, p_now: now });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/PGRST202|42883|dash_tc_publish_map/.test(msg)) {
      throw new Error("Akun Threads terhubung, tetapi belum bisa dipakai posting: server belum siap (sql/016_threads_publish_map.sql). Hubungi pengelola platform.");
    }
    throw new Error("Akun Threads terhubung, tetapi gagal disiapkan untuk posting. Coba hubungkan ulang sebentar lagi.");
  }
  if (res.status !== "OK") throw new Error("Akun Threads tidak ditemukan saat disiapkan untuk posting. Coba hubungkan ulang.");
}

/* ------------------------------------------------------------------ Graph API */

async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string }; error_message?: string }) | null;
  if (!res.ok || !body) {
    throw new Error(body?.error?.message || body?.error_message || `Threads API menolak permintaan (HTTP ${res.status}).`);
  }
  return body;
}

interface ThreadsProfile {
  threadsUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Ambil profil pemilik token dari `graph.threads.net/v1.0/me` (sekaligus memastikan token sah). */
export async function verifyThreadsAccessToken(accessToken: string): Promise<ThreadsProfile> {
  const q = new URLSearchParams({ fields: "id,username,name,threads_profile_picture_url", access_token: accessToken });
  const profile = await graph<{ id?: string; username?: string; name?: string; threads_profile_picture_url?: string }>(
    `${GRAPH}/v1.0/me?${q}`
  );
  if (!profile.id || !profile.username) throw new Error("Profil Threads tidak lengkap (id/username tidak ada).");
  return {
    threadsUserId: String(profile.id),
    username: profile.username.replace(/^@/, "").toLowerCase(),
    displayName: profile.name?.trim() || profile.username,
    avatarUrl: profile.threads_profile_picture_url ?? null,
  };
}

/** Tukar authorization code OAuth ➜ token pendek ➜ token long-lived (60 hari). */
export async function exchangeThreadsOAuthCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { appId, appSecret } = (await getRawIntegrations()).threadsOauth;
  if (!appId || !appSecret) throw new Error("Threads App ID dan App Secret belum dikonfigurasi.");

  const short = await graph<{ access_token?: string }>(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!short.access_token) throw new Error("Token akses Threads tidak ada pada respons OAuth.");

  const long = await graph<{ access_token?: string; expires_in?: number }>(
    `${GRAPH}/access_token?${new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    })}`
  );
  if (!long.access_token) throw new Error("Gagal menukar token Threads menjadi token 60 hari.");
  return { accessToken: long.access_token, expiresInSeconds: long.expires_in || LONG_LIVED_SECONDS };
}

/* ------------------------------------------------------------------ hubungkan */

/**
 * Hubungkan (atau hubungkan ulang) akun Threads ke workspace aktif dari sebuah access token.
 * `expiresInSeconds` diketahui pada alur OAuth; token tempelan dianggap long-lived 60 hari.
 */
export async function connectThreadsAccount(
  params: {
    workspaceId: string;
    userId: string;
    accessToken: string;
    expiresInSeconds?: number;
    via: "oauth" | "token";
  },
  now = new Date()
): Promise<{ ok: true; account: ConnectedThreadsAccountDTO } | Failure> {
  if (!tokenKeyConfigured()) return failure(503, NO_KEY);
  const rawToken = params.accessToken.trim();
  if (rawToken.length < 20 || /\s/.test(rawToken)) return failure(400, "Masukkan Access Token Threads yang valid.");

  let profile: ThreadsProfile;
  try {
    profile = await verifyThreadsAccessToken(rawToken);
  } catch (err) {
    return failure(400, err instanceof Error ? err.message : "Token Threads ditolak.");
  }

  const [current, linked, existingRes] = await Promise.all([
    listWorkspaceThreadsAccounts(params.workspaceId),
    linkedWorkspaces(params.workspaceId),
    db().from("ThreadsAccount").select("id, workspaceId").eq("threadsUserId", profile.threadsUserId).maybeSingle(),
  ]);
  const existing = existingRes.data as { id: string; workspaceId: string } | null;

  if (existing && !linked.has(existing.workspaceId)) {
    return failure(409, `Akun @${profile.username} sudah terhubung ke workspace lain.`);
  }
  if (current.quota.expired) {
    return failure(403, "Masa berlaku paket workspace sudah habis. Perpanjang paket di tab Langganan & Tagihan.");
  }
  if (!existing && current.quota.max !== null && current.quota.used >= current.quota.max) {
    return failure(
      403,
      `Kuota akun Threads paket ${current.quota.planNama ?? "Anda"} sudah penuh (${current.quota.used}/${current.quota.max}). Naikkan paket untuk menambah akun.`
    );
  }

  const stamp = nowTs();
  const expiresAt = sqlTs(new Date(now.getTime() + (params.expiresInSeconds ?? LONG_LIVED_SECONDS) * 1000));
  const fields = {
    username: profile.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    accessToken: encryptThreadsToken(rawToken),
    accessExpiresAt: expiresAt,
    scopes: THREADS_SCOPES,
    needsReconnect: false,
    connectedAt: stamp,
    updatedAt: stamp,
  };

  const accountId = existing?.id ?? randomUUID();
  const workspaceId = existing?.workspaceId ?? params.workspaceId;
  if (existing) {
    const { error } = await db().from("ThreadsAccount").update(fields).eq("id", existing.id);
    if (error) return failure(500, `Gagal memperbarui akun Threads: ${error.message}`);
  } else {
    await ensureWorkspaceRow(workspaceId);
    const { error } = await db()
      .from("ThreadsAccount")
      .insert({ id: accountId, workspaceId, threadsUserId: profile.threadsUserId, createdAt: stamp, ...fields });
    if (error) {
      if (/duplicate|23505/i.test(error.message)) return failure(409, `Akun @${profile.username} baru saja dihubungkan. Muat ulang halaman.`);
      return failure(500, `Gagal menyimpan akun Threads: ${error.message}`);
    }
  }

  try {
    await ensurePublishMapping(accountId, now);
  } catch (err) {
    console.error("[threads-connect] pemetaan posting gagal:", err);
    return failure(500, err instanceof Error ? err.message : "Gagal memetakan akun untuk posting.");
  }

  await rpc<null>("dash_sa_log", {
    p_actor: params.userId,
    p_action: existing ? "THREADS_HUBUNGKAN_ULANG" : "THREADS_HUBUNGKAN",
    p_type: "WORKSPACE",
    p_target: params.workspaceId,
    p_detail: { accountId, username: profile.username, via: params.via },
    p_now: now,
  }).catch(() => null);

  forgetAccountCaches();
  forgetPublishAccounts();
  forgetMembership();

  const prev = current.accounts.find((a) => a.id === accountId);
  return {
    ok: true,
    account: {
      id: accountId,
      threadsUserId: profile.threadsUserId,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      needsReconnect: false,
      accessExpiresAt: `${expiresAt}Z`,
      scopes: THREADS_SCOPES,
      connectedAt: `${stamp}Z`,
      autopilotMode: prev?.autopilotMode ?? "MATI",
      postsPerDay: prev?.postsPerDay ?? 3,
    },
  };
}
