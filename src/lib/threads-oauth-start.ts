/**
 * Awal OAuth resmi Meta Threads, dipakai tombol "Hubungkan Akun Threads" (/api/threads/oauth) dan jalur QR dari
 * komputer (/api/threads/pair/*): cek fitur, https, paket, dan kuota, lalu bentuk alamat halaman izin Threads.
 * Redirect URI `<APP_URL>/api/threads/oauth/callback` harus terdaftar persis di Meta App dan wajib https.
 */
import type { NextRequest } from "next/server";
import { appOrigin } from "./google-oauth";
import { getRawIntegrations } from "./integrations";
import { THREADS_SCOPES, listWorkspaceThreadsAccounts, signThreadsOAuthState } from "./threads-connect";
import { tokenKeyConfigured } from "./threads-token";

/** Kode galat yang dipetakan ke pesan di halaman Akun Threads (`?threads_error=`). */
export const THREADS_START_ERRORS: Record<string, string> = {
  threads_oauth_off: "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform.",
  threads_key_off: "Fitur hubungkan akun Threads belum diaktifkan oleh pengelola platform.",
  threads_insecure: "Login Threads hanya bisa dari alamat https.",
};

export const threadsStartErrorText = (code: string): string => THREADS_START_ERRORS[code] ?? code;

export type ThreadsStart =
  | { origin: string; error: string; url?: undefined }
  | { origin: string; error: null; url: string };

/**
 * Siapkan pengalihan ke halaman izin Threads untuk pengguna + workspace ini. `error` berisi kode
 * (lihat THREADS_START_ERRORS) atau pesan yang siap ditampilkan.
 */
export async function startThreadsAuthorize(
  request: Pick<NextRequest, "headers" | "nextUrl">,
  who: { userId: string; workspaceId: string | null },
  opts: { reconnect?: boolean } = {}
): Promise<ThreadsStart> {
  const cfg = await getRawIntegrations();
  const origin = appOrigin(request, cfg.googleOauth.appUrl);
  const fail = (error: string): ThreadsStart => ({ origin, error });

  if (!who.workspaceId) return fail("Workspace tidak ditemukan.");
  if (!cfg.threadsOauth.enabled || !cfg.threadsOauth.appId || !cfg.threadsOauth.appSecret) return fail("threads_oauth_off");
  if (!tokenKeyConfigured()) return fail("threads_key_off");
  // Meta menolak login dari halaman http ("Insecure Login Blocked"): jelaskan di dashboard, jangan kirim ke halaman galat Meta.
  if (!origin.startsWith("https://")) return fail("threads_insecure");

  // Cek paket sebelum ke Threads, supaya pengguna tidak sudah memberi izin lalu baru ditolak.
  // Kuota penuh tetap boleh lanjut untuk hubungkan ulang (tidak menambah kuota); akun baru tetap ditolak saat disimpan.
  const { quota, accounts } = await listWorkspaceThreadsAccounts(who.workspaceId);
  if (quota.expired) return fail("Masa berlaku paket sudah habis. Perpanjang paket di tab Langganan & Tagihan.");
  if (quota.max !== null && quota.used >= quota.max && !opts.reconnect && !accounts.some((a) => a.needsReconnect)) {
    return fail(`Kuota akun paket ${quota.planNama ?? "Anda"} sudah penuh (${quota.used}/${quota.max}). Naikkan paket untuk menambah akun.`);
  }

  // State bertanda tangan (bukan cookie): callback tetap sah walau selesai di aplikasi/browser/perangkat lain.
  const state = signThreadsOAuthState({ userId: who.userId, workspaceId: who.workspaceId });
  // Langsung ke host akhir dengan garis miring penutup: threads.net/oauth/authorize dialihkan (301) ke www.threads.com,
  // dan di HP tautan threads.* dibuka di aplikasi Threads (halaman izin tidak muncul). Daftar universal link Threads
  // (/.well-known/apple-app-site-association) mengecualikan "/oauth/authorize/*", jadi hanya bentuk ini yang tetap di browser.
  const authUrl = new URL("https://www.threads.com/oauth/authorize/");
  authUrl.searchParams.set("client_id", cfg.threadsOauth.appId);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/threads/oauth/callback`);
  authUrl.searchParams.set("scope", THREADS_SCOPES.join(","));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  // iOS: fragmen #weblink adalah aturan pengecualian PERTAMA di AASA Threads (aturan pertama yang cocok menang), dan
  // fragmen ikut terbawa saat Threads mengalihkan ke /login, jadi halaman login + izin tetap di Safari.
  const browserUrl = `${authUrl.toString()}#weblink`;
  const ua = request.headers.get("user-agent") ?? "";
  // WebView aplikasi lain ("; wv)") tidak memahami intent:, jadi tetap pakai https biasa.
  const url = /Android/i.test(ua) && !/; wv\)/.test(ua) ? androidBrowserIntent(browserUrl) : browserUrl;
  return { origin, error: null, url };
}

/**
 * Android: assetlinks.json Threads mencakup semua URL threads.*, jadi link biasa ke halaman izin dibuka di aplikasi
 * Threads. Intent ke skema yang tidak dimiliki aplikasi mana pun pasti gagal; Chrome lalu menandai seluruh rangkaian
 * navigasi ini "jangan buka aplikasi" (crbug.com/330555390) dan memuat browser_fallback_url di tab yang sama, termasuk
 * pengalihan ke /login sesudahnya. (Intent ke package Chrome sendiri tidak cukup: Chrome hanya memuatnya ulang di
 * rangkaian yang sama, dan App Link Threads tetap mengambil alih.)
 */
function androidBrowserIntent(httpsUrl: string): string {
  return `intent://buka#Intent;scheme=bottrit-web;S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}
