import { NextResponse, type NextRequest } from "next/server";
import { handleXenditCallback } from "@/lib/billing";
import { clientIp } from "@/lib/session-cookie";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Callback Invoice Xendit (atur di Xendit Dashboard > Settings > Webhooks > Invoices paid).
 * Status lunas selalu diverifikasi ulang ke API Xendit; isi callback tidak dipercaya.
 */
export async function POST(request: NextRequest) {
  if (!throttle(`xendit-cb:${clientIp(request)}`, 120, 60_000).ok) {
    return NextResponse.json({ success: false, error: "Terlalu banyak permintaan." }, { status: 429, headers: NO_STORE });
  }
  try {
    const body = await request.json().catch(() => null);
    const res = await handleXenditCallback(body, request.headers.get("x-callback-token"));
    return NextResponse.json({ success: res.status < 300, message: res.message }, { status: res.status, headers: NO_STORE });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json({ success: false, error: "Kesalahan server webhook." }, { status: 500, headers: NO_STORE });
  }
}
