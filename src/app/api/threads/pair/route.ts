import { NextResponse, type NextRequest } from "next/server";
import { internalError, jsonError } from "@/lib/api-auth";
import { appOrigin } from "@/lib/google-oauth";
import { getRawIntegrations } from "@/lib/integrations";
import { clientIp } from "@/lib/session-cookie";
import { THREADS_START_ERRORS } from "@/lib/threads-oauth-start";
import { createPairing, qrSvg } from "@/lib/threads-pairing";
import { throttle } from "@/lib/throttle";

/**
 * Publik (komputer tanpa sesi dashboard): buat pairing QR untuk menghubungkan akun Threads. QR berisi alamat
 * persetujuan di HP; `pollToken` hanya dipegang komputer ini untuk memantau status dan melanjutkan ke Threads.
 */
export async function POST(request: NextRequest) {
  const limit = throttle(`threads-pair:create:${clientIp(request)}`, 20, 10 * 60_000);
  if (!limit.ok) {
    return jsonError(429, "Terlalu banyak QR dibuat. Coba lagi sebentar.", undefined, { "Retry-After": String(limit.retryAfter) });
  }
  try {
    const cfg = await getRawIntegrations();
    if (!cfg.threadsOauth.enabled || !cfg.threadsOauth.appId || !cfg.threadsOauth.appSecret) {
      return jsonError(503, THREADS_START_ERRORS.threads_oauth_off);
    }
    const origin = appOrigin(request, cfg.googleOauth.appUrl);
    const pairing = createPairing();
    const approveUrl = `${origin}/hubungkan/${pairing.id}`;
    return NextResponse.json(
      { success: true, pollToken: pairing.pollToken, expiresAt: new Date(pairing.expiresAt).toISOString(), approveUrl, qrSvg: qrSvg(approveUrl) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return internalError("threads/pair", err);
  }
}
