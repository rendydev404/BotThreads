import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authConfigured } from "@/lib/auth";
import {
  OAUTH_COOKIE,
  appOrigin,
  decodeOauthCookie,
  exchangeCode,
  getGoogleConfig,
  stateMatches,
  usernameFromEmail,
} from "@/lib/google-oauth";
import { hashPassword } from "@/lib/password";
import { clientIp, setSessionCookie } from "@/lib/session-cookie";
import { db, nowTs } from "@/lib/supabase";
import { hashToken, signupOpen } from "@/lib/team-service";
import { acceptInvite, findGoogleUser, peekInvite, signup } from "@/lib/team-store";
import { throttle } from "@/lib/throttle";

/**
 * Kembali dari Google OAuth.
 * Bila akun sudah ada, langsung masuk dan tautkan googleSub.
 * Bila akun belum ada dan pendaftaran mandiri terbuka (`signupOpen()`), otomatis buatkan akun + workspace baru.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const gcfg = await getGoogleConfig();
  const origin = appOrigin(request, gcfg.appUrl);

  const clearCookies = (res: NextResponse) => {
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/" });
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
  };

  const fail = (code: string, why?: string) => {
    if (why) console.warn(`[auth/google] ${code}: ${why}`);
    const detail = why && process.env.NODE_ENV !== "production" ? `&why=${encodeURIComponent(why)}` : "";
    const res = NextResponse.redirect(new URL(`/login?error=${code}${detail}`, origin));
    clearCookies(res);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  if (!gcfg.enabled || !authConfigured()) return fail("google_off");
  if (!throttle(`google-cb:${clientIp(request)}`, 20, 60_000).ok) return fail("coba_lagi");

  const googleError = sp.get("error");
  if (googleError) {
    return fail(
      googleError === "access_denied" ? "google_ditolak" : "google_gagal",
      `Google: ${googleError.slice(0, 60)}`
    );
  }

  const saved = decodeOauthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  const code = sp.get("code");
  if (!saved) return fail("google_gagal", "cookie g_oauth tidak ditemukan (sesi kedaluwarsa atau beda domain/port)");
  if (!code || code.length > 2000) return fail("google_gagal", "kode otorisasi tidak ada");
  if (!stateMatches(saved.state, sp.get("state"))) return fail("google_gagal", "state tidak cocok");

  try {
    const profile = await exchangeCode(origin, code, saved.verifier, {
      clientId: gcfg.clientId,
      clientSecret: gcfg.clientSecret,
    });
    const now = new Date();

    let user: { id: string; passwordHash: string } | null = null;
    if (saved.invite) {
      const hash = hashToken(saved.invite);
      const invite = await peekInvite(hash, now);
      if (!invite || invite.email !== profile.email) return fail("undangan_email");
      const placeholder = await hashPassword(randomBytes(32).toString("base64url"));
      for (let attempt = 0; attempt < 3 && !user; attempt++) {
        try {
          const made = await acceptInvite(
            hash,
            {
              username: usernameFromEmail(profile.email, attempt ? `-${randomBytes(2).toString("hex")}` : ""),
              name: profile.name,
              passwordHash: placeholder,
            },
            profile.sub,
            now
          );
          if (!made) return fail("undangan_email");
          user = { id: made.userId, passwordHash: made.passwordHash };
        } catch (err) {
          if (!(err instanceof Error && /23505|duplicate key/i.test(err.message))) throw err;
        }
      }
    } else {
      const found = await findGoogleUser(profile.sub, profile.email, now);
      if (found?.isActive) {
        user = { id: found.id, passwordHash: found.passwordHash };
      }
      // Otomatis daftarkan akun + workspace baru bila email belum terdaftar dan pendaftaran terbuka
      if (!found && (saved.signup || (await signupOpen()))) {
        const placeholder = await hashPassword(randomBytes(32).toString("base64url"));
        const brand =
          (profile.name ?? profile.email.split("@")[0])
            .replace(/[<>]/g, " ")
            .trim()
            .slice(0, 80) || "Workspace Baru";
        for (let attempt = 0; attempt < 3 && !user; attempt++) {
          const made = await signup(
            {
              username: usernameFromEmail(profile.email, attempt ? `-${randomBytes(2).toString("hex")}` : ""),
              email: profile.email,
              name: profile.name,
              passwordHash: placeholder,
            },
            brand,
            now
          );
          if (made.status === "OK") {
            user = { id: made.userId, passwordHash: made.passwordHash };
            // Tautkan googleSub ke akun yang baru dibuat
            await findGoogleUser(profile.sub, profile.email, now).catch(() => null);
          } else if (made.status === "EMAIL") {
            break;
          }
        }
      }
    }
    if (!user) return fail("google_tidak_terdaftar", `tidak ada akun aktif dengan email ${profile.email}`);

    const stamp = nowTs();
    void Promise.resolve(
      db().from("DashboardUser").update({ lastLoginAt: stamp, updatedAt: stamp }).eq("id", user.id)
    ).catch(() => {});

    const res = NextResponse.redirect(new URL(saved.next, origin));
    await setSessionCookie(res, request, user.id, user.passwordHash);
    clearCookies(res);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    return fail("google_gagal", err instanceof Error ? err.message.slice(0, 200) : "galat tak dikenal");
  }
}
