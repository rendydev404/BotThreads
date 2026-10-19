import { db, must } from "@/lib/supabase";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  passwordFingerprint,
  verifySessionToken,
} from "@/lib/auth";
import { platformCtx } from "@/lib/platform";

export function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface LoginUser {
  id: string;
  username: string;
  name: string | null;
  passwordHash: string;
  isActive: boolean;
}

/** Kutip nilai untuk filter or() PostgREST agar koma/titik/kurung tidak ditafsirkan. */
const quote = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`;

/** Cari pengguna lewat username ATAU email (tidak peka huruf besar/kecil). */
export async function findUserByIdentifier(identifier: string): Promise<LoginUser | null> {
  const id = quote(normalizeIdentifier(identifier));
  return must<LoginUser | null>(
    db()
      .from("DashboardUser")
      .select("id, username, name, passwordHash, isActive")
      .or(`username.eq.${id},email.eq.${id}`)
      .limit(1)
      .maybeSingle()
  );
}

// Cache status pengguna agar proxy tidak query DB di setiap request.
// Menonaktifkan akun / mengganti password berlaku paling lambat TTL ini.
const STATUS_TTL_MS = 30_000;
const STATUS_CACHE_MAX = 5_000;
const statusCache = new Map<string, { at: number; ok: boolean; pv: string; validAfter: number | null }>();

async function currentStatus(userId: string) {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit;

  const [user, platform] = await Promise.all([
    must<{ isActive: boolean; passwordHash: string } | null>(
      db()
        .from("DashboardUser")
        .select("isActive, passwordHash")
        .eq("id", userId)
        .maybeSingle()
    ),
    platformCtx(userId),
  ]);
  const entry = {
    at: Date.now(),
    ok: !!user?.isActive,
    pv: user ? await passwordFingerprint(user.passwordHash) : "",
    // Super admin bisa menggugurkan semua sesi lama tanpa mengganti password.
    validAfter: platform.sessionsValidAfter,
  };
  // Urutan sisip Map = urutan umur: buang yang tertua saja (mengosongkan semua sekaligus membuat
  // ratusan pengguna aktif menembak database bersamaan).
  statusCache.delete(userId);
  statusCache.set(userId, entry);
  if (statusCache.size > STATUS_CACHE_MAX) statusCache.delete(statusCache.keys().next().value as string);
  return entry;
}

/** Akun masih aktif (tidak dinonaktifkan/diblokir)? Untuk alur tanpa sesi, mis. callback OAuth bertanda tangan. */
export async function isUserActive(userId: string): Promise<boolean> {
  return (await currentStatus(userId)).ok;
}

export function forgetUserStatus(userId: string) {
  statusCache.delete(userId);
}

/** Id pengguna jika cookie sesi sah dan akunnya masih aktif, selain itu null. */
export async function getSessionUserId(
  cookieValue: string | undefined
): Promise<string | null> {
  const payload = await verifySessionToken(cookieValue);
  if (!payload) return null;
  try {
    const status = await currentStatus(payload.uid);
    // Token tidak menyimpan waktu terbit; diturunkan dari masa berlakunya (umur sesi tetap).
    const issuedAt = (payload.exp - SESSION_MAX_AGE) * 1000;
    // Toleransi 1 detik: `exp` dibulatkan ke detik, batasnya bermilidetik.
    const revoked = status.validAfter !== null && issuedAt + 1000 < status.validAfter;
    return status.ok && status.pv === payload.pv && !revoked ? payload.uid : null;
  } catch (err) {
    // Gagal tutup: jika DB tidak terjangkau, anggap belum login.
    console.error("Session status check failed:", err);
    return null;
  }
}

export { SESSION_COOKIE };
