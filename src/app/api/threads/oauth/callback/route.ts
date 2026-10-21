import { NextResponse, type NextRequest } from "next/server";
import { afterResponse } from "@/lib/after-safe";
import { kickOnboarding } from "@/lib/account-onboarding";
import { appOrigin } from "@/lib/google-oauth";
import { getRawIntegrations } from "@/lib/integrations";
import { ctxForUser, getCtx, hasRole, scopeOf, type RequestCtx } from "@/lib/request-ctx";
import { runScoped } from "@/lib/tenant-scope";
import {
  THREADS_OAUTH_COOKIE,
  connectThreadsAccount,
  exchangeThreadsOAuthCode,
  verifyThreadsOAuthState,
} from "@/lib/threads-connect";
import { isUserActive } from "@/lib/users";

/**
 * Callback Meta Threads OAuth: tukar code menjadi token 60 hari lalu simpan akun ke workspace.
 *
 * Publik (tanpa sesi wajib): di HP halaman izin Threads sering terbuka di aplikasi Threads atau browser lain,
 * jadi callback bisa datang tanpa cookie sesi dashboard. Identitas diambil dari `state` bertanda tangan
 * (pengguna + workspace + masa berlaku). Bila ada sesi, sesinya harus milik pengguna yang sama.
 */
/** Agen onboarding berjalan di `after()` dan ikut batas waktu route ini. */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const cfg = await getRawIntegrations();
  const origin = appOrigin(request, cfg.googleOauth.appUrl);

  let session: RequestCtx | null = null;
  try {
    session = await getCtx(request);
  } catch {
    session = null;
  }

  // Ada sesi: kembali ke halaman Akun Threads. Tanpa sesi (browser lain): halaman hasil yang publik.
  const finish = (query: string) => {
    const path = session ? `/akun?${query}` : `/threads-terhubung?${query}`;
    const res = NextResponse.redirect(new URL(path, origin));
    res.cookies.delete({ name: THREADS_OAUTH_COOKIE, path: "/" });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  const fail = (msg: string) => finish(`threads_error=${encodeURIComponent(msg.slice(0, 160))}`);

  const denied = sp.get("error_description") || sp.get("error");
  // access_denied: pengguna menekan Batal, ATAU (selama aplikasi Meta masih mode pengembangan) akun Threads-nya
  // belum terdaftar sebagai Threads Tester. Jelaskan keduanya supaya pengguna tahu harus bagaimana.
  if (denied) {
    return fail(
      sp.get("error") === "access_denied"
        ? "Akses ditolak di halaman Threads. Jika Anda tidak menekan Batal, akun Threads ini mungkin belum menerima undangan Threads Tester."
        : denied
    );
  }

  const state = verifyThreadsOAuthState(sp.get("state"));
  if (!state) return fail("Sesi login Threads kedaluwarsa. Silakan ulangi.");
  if (session && session.userId !== state.userId) return fail("Login Threads dimulai oleh pengguna lain. Silakan ulangi dari akun Anda.");

  let ctx: RequestCtx;
  try {
    if (!session && !(await isUserActive(state.userId))) return fail("Akun dashboard tidak aktif.");
    ctx = session ?? (await ctxForUser(state.userId));
  } catch (err) {
    console.warn("[threads/oauth] konteks gagal dimuat:", err instanceof Error ? err.message : err);
    return fail("Server sedang bermasalah. Coba lagi sebentar.");
  }
  if (ctx.workspaceId !== state.workspaceId) return fail("Workspace aktif berubah selama login Threads. Silakan ulangi.");
  if (!hasRole(ctx, "ADMIN")) return fail("Hanya Pemilik atau Admin yang bisa menghubungkan akun Threads.");

  // Threads kadang menambahkan "#_" di akhir code.
  const code = (sp.get("code") ?? "").replace(/#_$/, "").trim();
  if (!code) return fail("Kode otorisasi Threads tidak ditemukan.");

  return runScoped(scopeOf(ctx), async () => {
    try {
      const token = await exchangeThreadsOAuthCode(code, `${origin}/api/threads/oauth/callback`);
      const connected = await connectThreadsAccount({
        workspaceId: state.workspaceId,
        userId: ctx.userId,
        accessToken: token.accessToken,
        expiresInSeconds: token.expiresInSeconds,
        via: "oauth",
      });
      if (!connected.ok) return fail(connected.error);
      // Agen AI langsung mempelajari akun hari ini juga: baca postingan, kenali peran, riset tren, isi ide.
      const accountId = connected.account.id;
      afterResponse("onboarding", () => kickOnboarding(accountId, state.workspaceId, ctx.userId));
      return finish(`threads_connected=${encodeURIComponent(connected.account.username)}`);
    } catch (err) {
      console.warn("[threads/oauth] callback gagal:", err instanceof Error ? err.message : err);
      return fail(err instanceof Error ? err.message : "Gagal menghubungkan akun Threads.");
    }
  });
}
