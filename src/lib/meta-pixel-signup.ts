import type { NextRequest, NextResponse } from "next/server";
import { PIXEL_EVENT_COOKIE, pixelEventCookie, publicPixelId, sendServerEvent } from "./meta-pixel";
import { clientIp } from "./session-cookie";
import { SITE_URL } from "./site";

/**
 * Pendaftaran berhasil (form daftar atau Google): titipkan CompleteRegistration ke peramban lewat cookie
 * `bt_px_ev` (ditembakkan di halaman berikutnya) dan kirim event yang sama dari server lewat Conversions API
 * sesudah respons dikirim (`after`). Keduanya memakai `eventId` yang sama sehingga Meta menghitungnya sekali.
 * Pixel mati = tidak melakukan apa-apa. Galat apa pun ditelan: pendaftaran tidak boleh ikut gagal.
 */
export async function pixelSignup(
  res: NextResponse,
  request: NextRequest,
  email: string | null,
  eventId: string,
  schedule: (task: () => Promise<unknown>) => void
): Promise<void> {
  try {
    if (!(await publicPixelId())) return;
    res.cookies.set(PIXEL_EVENT_COOKIE, pixelEventCookie("CompleteRegistration", eventId), {
      path: "/",
      maxAge: 600,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      httpOnly: false,
    });
    const input = {
      eventName: "CompleteRegistration" as const,
      eventId,
      sourceUrl: `${SITE_URL}/daftar`,
      email,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
      fbp: request.cookies.get("_fbp")?.value ?? null,
      fbc: request.cookies.get("_fbc")?.value ?? null,
      customData: { content_name: "BotThreads", status: true },
    };
    schedule(() => sendServerEvent(input));
  } catch (err) {
    console.warn("[meta-pixel] signup:", err instanceof Error ? err.message : err);
  }
}
