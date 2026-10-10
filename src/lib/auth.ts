/**
 * Sesi login berbasis cookie bertanda tangan (HMAC-SHA256, Web Crypto).
 * Aman dipakai di proxy maupun route handler. Tanpa dependensi tambahan.
 *
 * Pengguna disimpan di tabel DashboardUser (lihat src/lib/users.ts).
 * Env yang dibutuhkan: AUTH_SECRET (string acak >= 32 karakter).
 */

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 hari

export interface SessionPayload {
  uid: string; // id pengguna
  exp: number; // detik epoch
  pv: string; // sidik jari hash password: ganti password = sesi lama batal
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function authConfigured(): boolean {
  return (process.env.AUTH_SECRET?.length ?? 0) >= 32;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.AUTH_SECRET ?? ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/** Sidik jari pendek dari hash password tersimpan. */
export async function passwordFingerprint(passwordHash: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(passwordHash));
  return b64urlEncode(new Uint8Array(digest)).slice(0, 16);
}

export async function createSessionToken(
  userId: string,
  passwordHash: string
): Promise<string> {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    pv: await passwordFingerprint(passwordHash),
  };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Memeriksa tanda tangan dan masa berlaku. Status pengguna dicek terpisah. */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token || !authConfigured()) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(sig) as BufferSource,
      enc.encode(body)
    );
    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(b64urlDecode(body))
    ) as SessionPayload;

    if (!payload.uid || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
