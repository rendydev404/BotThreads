/**
 * Masuk dengan Google (OAuth 2.0 authorization code + PKCE), tanpa pustaka tambahan.
 *
 * Mendukung kredensial dari panel Super Admin > Integrasi maupun variabel lingkungan
 * (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRawIntegrations } from "./integrations";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const FETCH_TIMEOUT_MS = 8000;

export const OAUTH_COOKIE = "g_oauth";
export const OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const CALLBACK_PATH = "/api/auth/google/callback";

export const googleConfigured = (): boolean =>
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export async function getGoogleConfig(): Promise<{
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  appUrl: string;
}> {
  try {
    const cfg = await getRawIntegrations();
    return {
      enabled: cfg.googleOauth.enabled && !!cfg.googleOauth.clientId && !!cfg.googleOauth.clientSecret,
      clientId: cfg.googleOauth.clientId,
      clientSecret: cfg.googleOauth.clientSecret,
      appUrl: cfg.googleOauth.appUrl,
    };
  } catch {
    const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
    const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
    return {
      enabled: !!(clientId && clientSecret),
      clientId,
      clientSecret,
      appUrl,
    };
  }
}

/**
 * Asal publik aplikasi untuk alamat kembali.
 * Perbaikan kritis: di localhost / 127.0.0.1 tanpa header x-forwarded-proto, gunakan protokol dari
 * nextUrl (http) dan jangan memaksa https supaya tidak gagal SSL / redirect_uri_mismatch.
 */
export function appOrigin(
  req: { headers: Headers; nextUrl: { origin: string; protocol?: string } },
  customAppUrl?: string
): string {
  const env = (customAppUrl || process.env.APP_URL)?.trim().replace(/\/+$/, "");
  if (env && /^https?:\/\//.test(env)) return env;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return req.nextUrl.origin;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  if (forwardedProto) return `${forwardedProto}://${host}`;
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  // Localhost mengikuti protokol sebenarnya: `next dev --experimental-https` harus menghasilkan https.
  if (isLocal) return `${req.nextUrl.protocol === "https:" ? "https" : "http"}://${host}`;
  const urlProto = req.nextUrl.protocol ? req.nextUrl.protocol.replace(":", "") : "https";
  return `${urlProto}://${host}`;
}

export interface OauthState {
  state: string;
  verifier: string;
  /** Path tujuan setelah masuk. */
  next: string;
  /** Token undangan yang sedang diterima (bila ada). */
  invite: string | null;
  /** Boleh membuatkan akun + workspace baru bila email belum terdaftar dan pendaftaran dibuka. */
  signup: boolean;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function newOauthState(next: string, invite: string | null, signup = false): OauthState {
  return { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), next, invite, signup };
}

export const encodeOauthCookie = (s: OauthState): string => Buffer.from(JSON.stringify(s)).toString("base64url");

export function decodeOauthCookie(raw: string | undefined): OauthState | null {
  if (!raw || raw.length > 2000) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OauthState>;
    if (typeof s.state !== "string" || typeof s.verifier !== "string" || typeof s.next !== "string") return null;
    return {
      state: s.state,
      verifier: s.verifier,
      next: s.next,
      invite: typeof s.invite === "string" ? s.invite : null,
      signup: s.signup === true,
    };
  } catch {
    return null;
  }
}

/** Bandingkan `state` dari Google dengan yang disimpan di cookie (waktu konstan). */
export function stateMatches(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizeUrl(origin: string, s: OauthState, clientId?: string): string {
  const q = new URLSearchParams({
    client_id: clientId || process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_type: "code",
    scope: "openid email profile",
    state: s.state,
    code_challenge: b64url(createHash("sha256").update(s.verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

/** Galat Google yang aman dicatat: pesannya hanya kode/status, tanpa token atau rahasia. */
export class GoogleOauthError extends Error {}

/** Kode `error` dari balasan JSON Google (mis. `invalid_grant`), tanpa isi lainnya. */
async function googleErrorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; error_description?: unknown } | null;
  const code = typeof body?.error === "string" ? body.error.slice(0, 60) : "tanpa kode";
  const desc = typeof body?.error_description === "string" ? ` (${body.error_description.slice(0, 80)})` : "";
  return `${code}${desc}`;
}

/**
 * Tukar kode otorisasi dengan profil pengguna. Melempar `GoogleOauthError` bila Google menolak, email
 * belum terverifikasi, atau balasan tidak lengkap.
 */
export async function exchangeCode(
  origin: string,
  code: string,
  verifier: string,
  creds?: { clientId: string; clientSecret: string }
): Promise<GoogleProfile> {
  const clientId = creds?.clientId || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = creds?.clientSecret || process.env.GOOGLE_CLIENT_SECRET || "";
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: `${origin}${CALLBACK_PATH}`,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!tokenRes.ok) throw new GoogleOauthError(`token HTTP ${tokenRes.status}: ${await googleErrorCode(tokenRes)}`);
  const token = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof token.access_token !== "string") throw new GoogleOauthError("token tanpa access_token");

  const infoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!infoRes.ok) throw new GoogleOauthError(`userinfo HTTP ${infoRes.status}`);
  const info = (await infoRes.json()) as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
  if (typeof info.sub !== "string" || typeof info.email !== "string") throw new GoogleOauthError("userinfo tidak lengkap");
  if (info.email_verified !== true) throw new GoogleOauthError("email Google belum terverifikasi");
  return {
    sub: info.sub,
    email: info.email.toLowerCase(),
    name: typeof info.name === "string" ? info.name.slice(0, 80) : null,
  };
}

/** Username dari email untuk pengguna baru lewat undangan/daftar + Google (dengan akhiran acak bila perlu). */
export function usernameFromEmail(email: string, suffix = ""): string {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "").slice(0, 24);
  return `${base.length >= 3 ? base : `user${base}`}${suffix}`;
}
