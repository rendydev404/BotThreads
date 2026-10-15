/**
 * Konteks platform (sql/010_superadmin.sql): siapa super admin, siapa diblokir, workspace mana yang
 * ditangguhkan, dan saklar platform. Dibaca di jalur panas (cek sesi dan keanggotaan), jadi di-cache
 * singkat per pengguna. Sebelum sql/010 dipasang semuanya bernilai bawaan: tidak ada super admin,
 * tidak ada yang diblokir atau ditangguhkan, semua saklar menyala.
 *
 * Modul ini sengaja tidak mengimpor modul sesi/pengguna supaya bisa dipakai dari keduanya.
 */
import { rpc, utc } from "./supabase";

export interface PlatformFlags {
  /** Pendaftaran mandiri dibuka (masih butuh SIGNUP_ENABLED=true di server). */
  signupOpen: boolean;
  /** False = autopilot dihentikan untuk semua workspace. */
  autopilotGlobal: boolean;
  announcement: string | null;
}

export interface PlatformCtx {
  superadmin: boolean;
  banned: boolean;
  bannedReason: string | null;
  /** Epoch ms; sesi yang diterbitkan sebelum ini tidak berlaku. Null = tidak ada batas. */
  sessionsValidAfter: number | null;
  /** Workspace pengguna yang sedang ditangguhkan: id -> alasan. */
  suspended: Map<string, string | null>;
  flags: PlatformFlags;
}

export const DEFAULT_FLAGS: PlatformFlags = { signupOpen: true, autopilotGlobal: true, announcement: null };
const DEFAULT_CTX: PlatformCtx = { superadmin: false, banned: false, bannedReason: null, sessionsValidAfter: null, suspended: new Map(), flags: DEFAULT_FLAGS };

const TTL_MS = 30_000;
/** Setelah tahu skemanya belum dipasang, jangan bertanya lagi ke database selama ini. */
const MISSING_TTL_MS = 5 * 60_000;
const isMissing = (err: unknown): boolean => err instanceof Error && /PGRST202|42883|42P01|42703/.test(err.message) && /dash_sa_|Platform/.test(err.message);

let missingUntil = 0;
const ctxCache = new Map<string, { at: number; value: PlatformCtx }>();
let flagsCache: { at: number; value: PlatformFlags } | null = null;

interface RawCtx {
  superadmin: boolean;
  banned: boolean;
  bannedReason: string | null;
  sessionsValidAfter: string | null;
  suspended: { workspaceId: string; reason: string | null }[];
  flags: PlatformFlags;
}

const cleanFlags = (f: Partial<PlatformFlags> | null | undefined): PlatformFlags => ({
  signupOpen: f?.signupOpen !== false,
  autopilotGlobal: f?.autopilotGlobal !== false,
  announcement: typeof f?.announcement === "string" && f.announcement.trim() ? f.announcement : null,
});

/** Konteks platform satu pengguna (cache 30 detik). Galat selain "skema belum ada" dilempar (gagal tutup). */
export async function platformCtx(userId: string): Promise<PlatformCtx> {
  const now = Date.now();
  if (now < missingUntil) return DEFAULT_CTX;
  const hit = ctxCache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  try {
    const raw = await rpc<RawCtx>("dash_sa_ctx", { p_user: userId });
    const value: PlatformCtx = {
      superadmin: raw.superadmin === true,
      banned: raw.banned === true,
      bannedReason: raw.bannedReason ?? null,
      sessionsValidAfter: raw.sessionsValidAfter ? utc(raw.sessionsValidAfter).getTime() : null,
      suspended: new Map((raw.suspended ?? []).map((s) => [s.workspaceId, s.reason])),
      flags: cleanFlags(raw.flags),
    };
    ctxCache.set(userId, { at: now, value });
    flagsCache = { at: now, value: value.flags };
    if (ctxCache.size > 500) ctxCache.clear();
    return value;
  } catch (err) {
    if (!isMissing(err)) throw err;
    missingUntil = now + MISSING_TTL_MS;
    return DEFAULT_CTX;
  }
}

/** Saklar platform tanpa konteks pengguna (halaman masuk/daftar, tick autopilot). Cache 30 detik. */
export async function platformFlags(): Promise<PlatformFlags> {
  const now = Date.now();
  if (now < missingUntil) return DEFAULT_FLAGS;
  if (flagsCache && now - flagsCache.at < TTL_MS) return flagsCache.value;
  try {
    const value = cleanFlags(await rpc<PlatformFlags>("dash_sa_flags"));
    flagsCache = { at: now, value };
    return value;
  } catch (err) {
    if (!isMissing(err)) throw err;
    missingUntil = now + MISSING_TTL_MS;
    return DEFAULT_FLAGS;
  }
}

/** Buang cache setelah tindakan admin, supaya blokir/penangguhan/saklar berlaku seketika di proses ini. */
export function forgetPlatform(userId?: string): void {
  if (userId) ctxCache.delete(userId);
  else ctxCache.clear();
  flagsCache = null;
  missingUntil = 0;
}
