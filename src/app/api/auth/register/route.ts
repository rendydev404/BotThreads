import { NextResponse, type NextRequest } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { authConfigured } from "@/lib/auth";
import { isSameOrigin } from "@/lib/same-origin";
import { clientIp, setSessionCookie } from "@/lib/session-cookie";
import { registerAccount, signupOpen } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Daftar mandiri. Body: `{ email, username, name?, brand, password }`. Membuat akun dan workspace baru
 * (pendaftar menjadi Pemilik) lalu langsung memasang sesi. Publik, jadi dibatasi ketat per alamat IP
 * dan hanya aktif bila `SIGNUP_ENABLED=true` serta tidak ditutup super admin.
 */
export async function POST(request: NextRequest) {
  if (!authConfigured()) return jsonError(503, "Login belum dikonfigurasi di server.");
  if (!(await signupOpen())) return jsonError(403, "Pendaftaran belum dibuka. Minta undangan dari pemilik workspace.", undefined, NO_STORE);
  if (!isSameOrigin(request)) return jsonError(403, "Permintaan tidak valid.");
  // 5 percobaan per jam per IP: cukup untuk salah ketik, terlalu sedikit untuk membuat akun massal.
  const limit = throttle(`register:${clientIp(request)}`, 5, 60 * 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu banyak percobaan mendaftar. Coba lagi nanti.", undefined, { "Retry-After": String(limit.retryAfter) });

  try {
    const result = await registerAccount(await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error, undefined, NO_STORE);
    const res = NextResponse.json({ success: true }, { status: 201, headers: NO_STORE });
    await setSessionCookie(res, request, result.session.userId, result.session.passwordHash);
    return res;
  } catch (err) {
    console.error("[auth/register]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
  }
}
