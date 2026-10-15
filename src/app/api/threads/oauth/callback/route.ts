import { NextResponse } from "next/server";
import { appOrigin, stateMatches } from "@/lib/google-oauth";
import { getRawIntegrations } from "@/lib/integrations";
import { withCtx } from "@/lib/request-ctx";
import { THREADS_OAUTH_COOKIE, connectThreadsAccount, exchangeThreadsOAuthCode } from "@/lib/threads-connect";

/** Callback Meta Threads OAuth: tukar code menjadi token 60 hari lalu simpan akun ke workspace. */
export const GET = withCtx("ADMIN", async (request, ctx) => {
  const sp = request.nextUrl.searchParams;
  const cfg = await getRawIntegrations();
  const origin = appOrigin(request, cfg.googleOauth.appUrl);

  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`/pengaturan?tab=akun&${query}`, origin));
    res.cookies.delete({ name: THREADS_OAUTH_COOKIE, path: "/" });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  const fail = (msg: string) => finish(`threads_error=${encodeURIComponent(msg.slice(0, 160))}`);

  if (!ctx.workspaceId) return fail("Workspace tidak ditemukan.");
  const denied = sp.get("error_description") || sp.get("error");
  if (denied) return fail(sp.get("error") === "access_denied" ? "Izin ditolak di halaman Threads." : denied);

  const [savedState, savedWs] = (request.cookies.get(THREADS_OAUTH_COOKIE)?.value ?? "").split(".");
  if (!savedState || !stateMatches(savedState, sp.get("state"))) return fail("Sesi login Threads kedaluwarsa. Silakan ulangi.");
  if (savedWs !== ctx.workspaceId) return fail("Workspace aktif berubah selama login Threads. Silakan ulangi.");

  // Threads kadang menambahkan "#_" di akhir code.
  const code = (sp.get("code") ?? "").replace(/#_$/, "").trim();
  if (!code) return fail("Kode otorisasi Threads tidak ditemukan.");

  try {
    const token = await exchangeThreadsOAuthCode(code, `${origin}/api/threads/oauth/callback`);
    const connected = await connectThreadsAccount({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      accessToken: token.accessToken,
      expiresInSeconds: token.expiresInSeconds,
      via: "oauth",
    });
    if (!connected.ok) return fail(connected.error);
    return finish(`threads_connected=${encodeURIComponent(connected.account.username)}`);
  } catch (err) {
    console.warn("[threads/oauth] callback gagal:", err instanceof Error ? err.message : err);
    return fail(err instanceof Error ? err.message : "Gagal menghubungkan akun Threads.");
  }
});
