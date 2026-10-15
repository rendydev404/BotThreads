import { NextResponse, type NextRequest } from "next/server";
import { handleMidtransNotification } from "@/lib/billing";
import { clientIp } from "@/lib/session-cookie";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Notifikasi HTTP Midtrans (Dashboard Midtrans > Settings > Configuration > Payment Notification URL;
 * charge juga mengirim header X-Append-Notification ke URL ini). signature_key dicek dan status lunas
 * selalu diverifikasi ulang ke API Midtrans; isi notifikasi tidak dipercaya.
 */
export async function POST(request: NextRequest) {
  if (!throttle(`midtrans-cb:${clientIp(request)}`, 120, 60_000).ok) {
    return NextResponse.json({ success: false, error: "Terlalu banyak permintaan." }, { status: 429, headers: NO_STORE });
  }
  try {
    const body = await request.json().catch(() => null);
    const res = await handleMidtransNotification(body);
    return NextResponse.json({ success: res.status < 300, message: res.message }, { status: res.status, headers: NO_STORE });
  } catch (err) {
    console.error("[billing/webhook]", err);
    return NextResponse.json({ success: false, error: "Kesalahan server webhook." }, { status: 500, headers: NO_STORE });
  }
}
