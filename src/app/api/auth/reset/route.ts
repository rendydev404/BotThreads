import { NextResponse, type NextRequest } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { isSameOrigin } from "@/lib/same-origin";
import { clientIp } from "@/lib/session-cookie";
import { resetPassword } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

/**
 * Pasang password baru dengan tautan reset dari admin (sekali pakai, 60 menit). Body: `{ token, password }`.
 * Publik: token adalah buktinya. Setelah berhasil, pengguna masuk lewat halaman login.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return jsonError(403, "Permintaan tidak valid.");
  if (!throttle(`reset:${clientIp(request)}`, 10, 10 * 60_000).ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");
  const body = (await readJson(request)) as { token?: unknown; password?: unknown } | null;
  try {
    const result = await resetPassword(body?.token, body?.password);
    if (!result.ok) return jsonError(result.status, result.error, undefined, { "Cache-Control": "no-store" });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[auth/reset]", err instanceof Error ? err.message : "galat tak dikenal");
    return jsonError(500, "Terjadi kesalahan pada server. Coba lagi sebentar lagi.");
  }
}
