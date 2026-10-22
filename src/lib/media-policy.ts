/**
 * Kebijakan postingan bergambar per akun ("Postingan bergambar" di pengaturan autopilot, sql/039).
 * MATI = tidak pernah bergambar; OTOMATIS = boleh selama porsi postingan bergambar akun itu (posting dashboard
 * 7 hari terakhir + yang akan datang) masih di bawah batas persen. Hitungan dikerjakan database dalam satu RPC
 * dan hasilnya disimpan di memori 60 detik per akun, jadi pemanggilan beruntun (cari ide massal) tetap murah.
 */
import { rpc, sqlTs } from "@/lib/supabase";
import { DEFAULT_SETTINGS, type MediaMode } from "./autopilot-types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jendela riwayat yang dihitung (ditambah semua posting yang akan datang). */
export const MEDIA_WINDOW_MS = 7 * DAY_MS;
const CACHE_MS = 60_000;
const CACHE_MAX = 2000;

export interface MediaPolicyRow {
  mode: MediaMode;
  maxPersen: number;
  /** Posting dashboard akun (dispatch MENUNGGU/TERBIT) sejak 7 hari lalu, termasuk yang akan datang. */
  total: number;
  /** Yang bergambar (IMAGE/CAROUSEL). */
  gambar: number;
}

/** Murni: gambar boleh dipakai bila mode OTOMATIS dan porsinya masih di bawah batas. */
export function mediaShareAllows(p: MediaPolicyRow): boolean {
  if (p.mode !== "OTOMATIS" || p.maxPersen <= 0) return false;
  if (p.total <= 0) return true;
  return p.gambar * 100 < p.maxPersen * p.total;
}

const cache = new Map<string, { at: number; allowed: boolean }>();

/** Kosongkan cache (dipakai uji, atau setelah pengaturan akun diubah). */
export function clearMediaPolicyCache(accountId?: string): void {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

/** Bacaan mentah dari database (tanpa cache). */
export async function loadMediaPolicy(accountId: string, now = new Date()): Promise<MediaPolicyRow> {
  const r = await rpc<Partial<MediaPolicyRow> | null>("dash_media_policy", {
    p_account_id: accountId,
    p_since: sqlTs(new Date(now.getTime() - MEDIA_WINDOW_MS)),
  });
  return {
    mode: r?.mode === "MATI" || r?.mode === "OTOMATIS" ? r.mode : DEFAULT_SETTINGS.mediaMode,
    maxPersen: typeof r?.maxPersen === "number" ? r.maxPersen : DEFAULT_SETTINGS.mediaMaxPersen,
    total: Number(r?.total) || 0,
    gambar: Number(r?.gambar) || 0,
  };
}

/**
 * Boleh memakai gambar untuk posting/preview berikutnya akun ini? Galat database (mis. sql/039 belum
 * dijalankan) dicatat singkat dan dianggap "tidak" (aman: posting tetap teks), juga disimpan 60 detik.
 */
export async function imageAllowed(accountId: string, now = new Date()): Promise<boolean> {
  const t = now.getTime();
  const hit = cache.get(accountId);
  if (hit && t - hit.at >= 0 && t - hit.at < CACHE_MS) return hit.allowed;

  let allowed = false;
  try {
    allowed = mediaShareAllows(await loadMediaPolicy(accountId, now));
  } catch (err) {
    console.error(`[media-policy] ${accountId}:`, err instanceof Error ? err.message : err);
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(accountId, { at: t, allowed });
  return allowed;
}
