/**
 * Pasang cookie sesi pada respons. Dipakai login password, login Google, terima undangan, dan ganti
 * password (sesi diterbitkan ulang karena sidik jari password berubah).
 */
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from "./auth";

/** Permintaan datang lewat HTTPS (langsung atau di belakang proxy)? */
export const isHttps = (req: NextRequest): boolean =>
  (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol).startsWith("https");

export async function setSessionCookie(res: NextResponse, req: NextRequest, userId: string, passwordHash: string): Promise<void> {
  res.cookies.set(SESSION_COOKIE, await createSessionToken(userId, passwordHash), {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * IP klien untuk pembatas laju endpoint publik. Hanya header yang ditulis proxy kita sendiri yang
 * dipercaya: Caddy menimpa X-Forwarded-For dari klien dengan alamat aslinya, sedangkan
 * `cf-connecting-ip` dan `x-real-ip` diteruskan apa adanya sehingga bisa dipalsukan untuk lolos dari
 * kunci per IP. `cf-connecting-ip` baru dipakai bila situs memang di belakang Cloudflare
 * (`TRUST_CLOUDFLARE_IP=true`).
 */
export function clientIp(req: { headers: Headers }): string {
  const cf = process.env.TRUST_CLOUDFLARE_IP === "true" ? req.headers.get("cf-connecting-ip")?.trim() : "";
  return cf || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
