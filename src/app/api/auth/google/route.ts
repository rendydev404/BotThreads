import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  appOrigin,
  authorizeUrl,
  encodeOauthCookie,
  getGoogleConfig,
  newOauthState,
} from "@/lib/google-oauth";
import { safeNextPath } from "@/lib/safe-next";
import { clientIp, isHttps } from "@/lib/session-cookie";
import { isToken, signupOpen } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

/**
 * Mulai masuk/daftar dengan Google: simpan `state` + PKCE di cookie httpOnly lalu alihkan ke Google.
 * Kredensial dibaca dari konfigurasi Integrasi Super Admin maupun variabel lingkungan.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const gcfg = await getGoogleConfig();
  const origin = appOrigin(request, gcfg.appUrl);
  const back = (code: string) => NextResponse.redirect(new URL(`/login?error=${code}`, origin));
  if (!gcfg.enabled) return back("google_off");
  if (!throttle(`google-start:${clientIp(request)}`, 20, 60_000).ok) return back("coba_lagi");

  const invite = sp.get("invite");
  const canSignup = await signupOpen();
  const state = newOauthState(
    safeNextPath(sp.get("next")),
    isToken(invite) ? invite : null,
    canSignup
  );
  const res = NextResponse.redirect(authorizeUrl(origin, state, gcfg.clientId));
  res.cookies.set(OAUTH_COOKIE, encodeOauthCookie(state), {
    httpOnly: true,
    secure: isHttps(request),
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
