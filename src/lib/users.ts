import { db, must } from "@/lib/supabase";
import {
  SESSION_COOKIE,
  passwordFingerprint,
  verifySessionToken,
} from "@/lib/auth";

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
const statusCache = new Map<string, { at: number; ok: boolean; pv: string }>();

async function currentStatus(userId: string) {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit;

  const user = await must<{ isActive: boolean; passwordHash: string } | null>(
    db()
      .from("DashboardUser")
      .select("isActive, passwordHash")
      .eq("id", userId)
      .maybeSingle()
  );
  const entry = {
    at: Date.now(),
    ok: !!user?.isActive,
    pv: user ? await passwordFingerprint(user.passwordHash) : "",
  };
  statusCache.set(userId, entry);
  if (statusCache.size > 200) statusCache.clear();
  return entry;
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
    return status.ok && status.pv === payload.pv ? payload.uid : null;
  } catch (err) {
    // Gagal tutup: jika DB tidak terjangkau, anggap belum login.
    console.error("Session status check failed:", err);
    return null;
  }
}

export { SESSION_COOKIE };
