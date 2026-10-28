import { NextResponse, type NextRequest } from "next/server";
import { getRawIntegrations } from "@/lib/integrations";
import { deauthorizeThreadsUser, parseSignedRequest, signedRequestFromBody } from "@/lib/threads-meta-callbacks";
import { throttle } from "@/lib/throttle";
import { clientIp } from "@/lib/session-cookie";

/**
 * Deauthorize callback URL (Threads use case > Settings): Meta memanggil ini saat pengguna mencabut akses app.
 * Diamankan `signed_request` (HMAC App Secret Threads). Token akun dikosongkan, akun "Perlu Hubungkan Ulang".
 */
export async function POST(request: NextRequest) {
  if (!throttle(`threads-deauth:${clientIp(request)}`, 60, 60_000).ok) return new NextResponse("Too many requests", { status: 429 });
  const { threadsOauth } = await getRawIntegrations();
  const raw = await request.text();
  const payload = parseSignedRequest(signedRequestFromBody(raw, request.headers.get("content-type")), threadsOauth.appSecret);
  if (!payload) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  try {
    const n = await deauthorizeThreadsUser(payload.user_id);
    return NextResponse.json({ success: true, accounts: n });
  } catch (err) {
    console.error("[threads/deauthorize]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
