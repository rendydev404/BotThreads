import { NextResponse, type NextRequest } from "next/server";
import { getRawIntegrations } from "@/lib/integrations";
import { deleteThreadsUserData, newConfirmationCode, parseSignedRequest, signedRequestFromBody } from "@/lib/threads-meta-callbacks";
import { throttle } from "@/lib/throttle";
import { clientIp } from "@/lib/session-cookie";

/**
 * Data Deletion Requests URL (Threads use case > Settings): Meta memanggil ini saat pengguna meminta datanya
 * dihapus. Diamankan `signed_request` (HMAC App Secret Threads). Akun dihapus seperti tombol "Hapus akun",
 * lalu dibalas `{ url, confirmation_code }` sesuai ketentuan Meta.
 */
export async function POST(request: NextRequest) {
  if (!throttle(`threads-delete:${clientIp(request)}`, 60, 60_000).ok) return new NextResponse("Too many requests", { status: 429 });
  const { threadsOauth } = await getRawIntegrations();
  const raw = await request.text();
  const payload = parseSignedRequest(signedRequestFromBody(raw, request.headers.get("content-type")), threadsOauth.appSecret);
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  try {
    const removed = await deleteThreadsUserData(payload.user_id);
    const code = newConfirmationCode();
    console.info(`[threads/data-deletion] kode ${code}: ${removed} akun dihapus`);
    return NextResponse.json({ url: `${request.nextUrl.origin}/penghapusan-data?kode=${code}`, confirmation_code: code });
  } catch (err) {
    console.error("[threads/data-deletion]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
