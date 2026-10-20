import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/google-oauth";
import { getRawIntegrations } from "@/lib/integrations";
import { withCtx } from "@/lib/request-ctx";
import { THREADS_SCOPES, listWorkspaceThreadsAccounts, signThreadsOAuthState } from "@/lib/threads-connect";
import { tokenKeyConfigured } from "@/lib/threads-token";

/**
 * Mulai OAuth resmi Meta Threads. Redirect URI `<APP_URL>/api/threads/oauth/callback` harus terdaftar
 * persis di Meta App (Threads use case > Settings > Redirect Callback URLs) dan wajib https.
 *
 * `?format=link` membalas JSON berisi alamat izin Threads (untuk tombol "Salin link login" di HP): link yang
 * ditempel di address bar tidak dialihkan sistem ke aplikasi Threads, jadi halaman izin tetap terbuka di browser.
 */
export const GET = withCtx("ADMIN", async (request, ctx) => {
  const cfg = await getRawIntegrations();
  const origin = appOrigin(request, cfg.googleOauth.appUrl);
  const asLink = request.nextUrl.searchParams.get("format") === "link";
  const back = (code: string) =>
    asLink
      ? NextResponse.json({ success: false, error: code }, { status: 400, headers: { "Cache-Control": "no-store" } })
      : NextResponse.redirect(new URL(`/akun?threads_error=${encodeURIComponent(code)}`, origin));

  if (!ctx.workspaceId) return back("Workspace tidak ditemukan.");
  if (!cfg.threadsOauth.enabled || !cfg.threadsOauth.appId || !cfg.threadsOauth.appSecret) return back("threads_oauth_off");
  if (!tokenKeyConfigured()) return back("threads_key_off");
  // Meta menolak login dari halaman http ("Insecure Login Blocked"): jelaskan di dashboard, jangan kirim ke halaman galat Meta.
  if (!origin.startsWith("https://")) return back("threads_insecure");

  // Cek paket sebelum ke Threads, supaya pengguna tidak sudah memberi izin lalu baru ditolak.
  // Kuota penuh tetap boleh lanjut untuk hubungkan ulang (tidak menambah kuota); akun baru tetap ditolak saat disimpan.
  const reconnect = request.nextUrl.searchParams.get("reconnect") === "1";
  const { quota, accounts } = await listWorkspaceThreadsAccounts(ctx.workspaceId);
  if (quota.expired) return back("Masa berlaku paket sudah habis. Perpanjang paket di tab Langganan & Tagihan.");
  if (quota.max !== null && quota.used >= quota.max && !reconnect && !accounts.some((a) => a.needsReconnect)) {
    return back(`Kuota akun paket ${quota.planNama ?? "Anda"} sudah penuh (${quota.used}/${quota.max}). Naikkan paket untuk menambah akun.`);
  }

  // State bertanda tangan (bukan cookie): callback tetap sah walau selesai di aplikasi/browser lain.
  const state = signThreadsOAuthState({ userId: ctx.userId, workspaceId: ctx.workspaceId });
  // Langsung ke host akhir dengan garis miring penutup: threads.net/oauth/authorize dialihkan (301) ke www.threads.com,
  // dan di HP tautan threads.* dibuka di aplikasi Threads (halaman izin tidak muncul). Daftar universal link Threads
  // (/.well-known/apple-app-site-association) mengecualikan "/oauth/authorize/*", jadi hanya bentuk ini yang tetap di browser.
  const authUrl = new URL("https://www.threads.com/oauth/authorize/");
  authUrl.searchParams.set("client_id", cfg.threadsOauth.appId);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/threads/oauth/callback`);
  authUrl.searchParams.set("scope", THREADS_SCOPES.join(","));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  if (asLink) return NextResponse.json({ success: true, url: authUrl.toString() }, { headers: { "Cache-Control": "no-store" } });
  const isAndroid = /Android/i.test(request.headers.get("user-agent") ?? "");
  const target = isAndroid ? androidBrowserIntent(authUrl.toString()) : authUrl.toString();
  return new NextResponse(null, { status: 307, headers: { Location: target, "Cache-Control": "no-store" } });
});

/**
 * Android tidak punya pengecualian path untuk tautan threads.* (assetlinks.json Threads = semua URL), jadi link
 * biasa ke halaman izin dibuka di aplikasi Threads. Intent yang menunjuk Chrome secara eksplisit tidak melewati
 * pemilih App Link, sehingga halaman izin Meta tetap terbuka di browser. Tanpa Chrome: kembali ke URL https biasa.
 */
function androidBrowserIntent(httpsUrl: string): string {
  const rest = httpsUrl.replace(/^https:\/\//, "");
  return `intent://${rest}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}
