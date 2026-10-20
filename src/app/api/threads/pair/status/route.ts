import { NextResponse, type NextRequest } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { clientIp } from "@/lib/session-cookie";
import { startThreadsAuthorize, threadsStartErrorText } from "@/lib/threads-oauth-start";
import { consumePairing, isPollToken, pairingByToken } from "@/lib/threads-pairing";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Publik (komputer yang memegang pollToken). Body `{ token }`: status pairing. Nama workspace & penyetuju baru
 * dibuka setelah disetujui, supaya pengguna komputer bisa memastikan sebelum lanjut.
 * Body `{ token, action: "lanjut" }`: pakai persetujuan (sekali) dan balas alamat halaman izin Threads.
 */
export async function POST(request: NextRequest) {
  const limit = throttle(`threads-pair:poll:${clientIp(request)}`, 120, 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu sering. Coba lagi sebentar.", undefined, { "Retry-After": String(limit.retryAfter) });

  const body = (await readJson(request)) as { token?: unknown; action?: unknown } | null;
  if (!isPollToken(body?.token)) return jsonError(400, "QR tidak valid. Muat ulang halaman.");
  const token = body.token;

  if (body.action === "lanjut") {
    const approval = consumePairing(token);
    if (approval === "NOT_FOUND") return jsonError(410, "QR sudah kedaluwarsa. Buat QR baru.");
    if (approval === "USED") return jsonError(409, "QR ini sudah dipakai. Buat QR baru.");
    if (approval === "NOT_APPROVED") return jsonError(409, "Belum disetujui dari HP.");
    try {
      const start = await startThreadsAuthorize(request, approval);
      if (start.error !== null) return jsonError(409, threadsStartErrorText(start.error));
      return NextResponse.json({ success: true, url: start.url }, { headers: NO_STORE });
    } catch (err) {
      return internalError("threads/pair/status", err);
    }
  }

  const p = pairingByToken(token);
  if (!p) return NextResponse.json({ success: true, status: "kedaluwarsa" }, { headers: NO_STORE });
  const approved = p.status === "disetujui" && p.approval;
  return NextResponse.json(
    {
      success: true,
      status: p.status,
      expiresAt: new Date(p.expiresAt).toISOString(),
      ...(approved ? { workspaceName: p.approval!.workspaceName, approverName: p.approval!.approverName } : {}),
    },
    { headers: NO_STORE }
  );
}
