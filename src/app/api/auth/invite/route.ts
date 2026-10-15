import { NextResponse, type NextRequest } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { authConfigured } from "@/lib/auth";
import { googleConfigured } from "@/lib/google-oauth";
import { isSameOrigin } from "@/lib/same-origin";
import { clientIp, setSessionCookie } from "@/lib/session-cookie";
import { acceptInviteWithPassword, previewInvite } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/** Isi undangan untuk halaman terima undangan. Publik: token di query adalah buktinya. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!throttle(`invite-peek:${clientIp(request)}`, 30, 60_000).ok) return jsonError(429, "Terlalu banyak permintaan. Tunggu sebentar.");
  try {
    const result = await previewInvite(token);
    if (!result.ok) return jsonError(result.status, result.error, undefined, NO_STORE);
    return NextResponse.json({ success: true, invite: result.invite, google: googleConfigured() }, { headers: NO_STORE });
  } catch (err) {
    console.error("[auth/invite:GET]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
  }
}

/**
 * Terima undangan. Body: `{ token, username, name?, password }` untuk pengguna baru (langsung masuk),
 * atau `{ token }` untuk email yang sudah punya akun (akses ditambahkan; masuk seperti biasa).
 */
export async function POST(request: NextRequest) {
  if (!authConfigured()) return jsonError(503, "Login belum dikonfigurasi di server.");
  if (!isSameOrigin(request)) return jsonError(403, "Permintaan tidak valid.");
  if (!throttle(`invite-accept:${clientIp(request)}`, 10, 10 * 60_000).ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");

  const body = (await readJson(request)) as { token?: unknown } | null;
  try {
    const result = await acceptInviteWithPassword(body?.token, body);
    if (!result.ok) return jsonError(result.status, result.error, undefined, NO_STORE);
    const res = NextResponse.json({ success: true, signedIn: !!result.session }, { headers: NO_STORE });
    if (result.session) await setSessionCookie(res, request, result.session.userId, result.session.passwordHash);
    return res;
  } catch (err) {
    console.error("[auth/invite:POST]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
  }
}
