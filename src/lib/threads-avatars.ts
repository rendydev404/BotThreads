/**
 * Foto profil akun Threads disimpan sebagai URL CDN Meta (cdninstagram/fbcdn) yang ditandatangani dan
 * kedaluwarsa sendiri sekitar 3-4 hari (parameter `oe`, detik epoch dalam heksadesimal). URL hanya diisi
 * saat akun dihubungkan, jadi tanpa penyegaran semua foto pecah setelah beberapa hari (403 "URL signature
 * expired"). Modul ini menyegarkan URL yang akan kedaluwarsa dari profil Threads (pakai token akun),
 * dipanggil berkala oleh tick autopilot.
 *
 * Hemat: hanya kolom id + avatarUrl yang dibaca untuk menyaring, token dibaca hanya untuk akun yang jatuh
 * tempo, jumlah per putaran dibatasi, dan putaran dijalankan paling sering tiap 30 menit.
 */
import { db } from "@/lib/supabase";
import { forgetPublishAccounts } from "./publish-accounts";
import { verifyThreadsAccessToken } from "./threads-connect";
import { decryptThreadsToken, tokenKeyConfigured } from "./threads-token";

const HOUR_MS = 60 * 60_000;
/** Segarkan bila URL kedaluwarsa dalam rentang ini (atau sudah kedaluwarsa). */
const REFRESH_AHEAD_MS = 24 * HOUR_MS;
/** Jarak minimal antarputaran dalam satu proses. */
const MIN_INTERVAL_MS = 30 * 60_000;
const MAX_PER_RUN = 60;
const CONCURRENCY = 6;
const PAGE = 1000;

/** Waktu kedaluwarsa URL CDN Meta (ms epoch); null bila URL tidak bertanda waktu. */
export function avatarExpiresAt(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const oe = new URL(url).searchParams.get("oe");
    if (!oe || !/^[0-9a-f]{6,12}$/i.test(oe)) return null;
    return parseInt(oe, 16) * 1000;
  } catch {
    return null;
  }
}

/** Akun yang foto profilnya perlu disegarkan, yang paling cepat kedaluwarsa lebih dulu. */
export function dueAvatars(rows: { id: string; avatarUrl: string | null }[], now: number, limit = MAX_PER_RUN): string[] {
  return rows
    .map((r) => ({ id: r.id, exp: avatarExpiresAt(r.avatarUrl) }))
    .filter((r): r is { id: string; exp: number } => r.exp !== null && r.exp - now < REFRESH_AHEAD_MS)
    .sort((a, b) => a.exp - b.exp || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((r) => r.id);
}

let lastRun = 0;
let running: Promise<AvatarRefreshResult> | null = null;

export interface AvatarRefreshResult {
  checked: number;
  refreshed: number;
  failed: number;
}

/** Segarkan URL foto profil yang akan kedaluwarsa. Aman dipanggil tiap tick (dibatasi waktu & serentak). */
export function refreshAvatars(now = new Date(), opts: { force?: boolean } = {}): Promise<AvatarRefreshResult> {
  if (running) return running;
  if (!opts.force && now.getTime() - lastRun < MIN_INTERVAL_MS) return Promise.resolve({ checked: 0, refreshed: 0, failed: 0 });
  lastRun = now.getTime();
  running = run(now).finally(() => (running = null));
  return running;
}

async function run(now: Date): Promise<AvatarRefreshResult> {
  if (!tokenKeyConfigured()) return { checked: 0, refreshed: 0, failed: 0 };

  // Halaman 1000 baris (batas bawaan PostgREST) dengan urutan unik.
  const rows: { id: string; avatarUrl: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from("ThreadsAccount")
      .select("id, avatarUrl")
      .eq("needsReconnect", false)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as { id: string; avatarUrl: string | null }[]));
    if (!data || data.length < PAGE) break;
  }

  const ids = dueAvatars(rows, now.getTime());
  if (ids.length === 0) return { checked: rows.length, refreshed: 0, failed: 0 };

  const { data: tokens, error } = await db().from("ThreadsAccount").select("id, accessToken").in("id", ids);
  if (error) throw new Error(error.message);

  let refreshed = 0;
  let failed = 0;
  const queue = [...((tokens ?? []) as { id: string; accessToken: string | null }[])];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          if (!t.accessToken) throw new Error("token kosong");
          const profile = await verifyThreadsAccessToken(decryptThreadsToken(t.accessToken));
          const { error: upErr } = await db().from("ThreadsAccount").update({ avatarUrl: profile.avatarUrl }).eq("id", t.id);
          if (upErr) throw new Error(upErr.message);
          refreshed += 1;
        } catch (err) {
          // Token dicabut/kedaluwarsa: biarkan; UI menampilkan inisial dan status akun sudah ditangani di tempat lain.
          failed += 1;
          console.warn(`[avatar] gagal menyegarkan ${t.id}:`, err instanceof Error ? err.message : err);
        }
      }
    })
  );
  if (refreshed) forgetPublishAccounts();
  return { checked: rows.length, refreshed, failed };
}
