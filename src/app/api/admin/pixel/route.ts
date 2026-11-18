import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { getPixelConfig, savePixelConfig, sendServerEvent, toAdminDTO } from "@/lib/meta-pixel";
import { withAdmin } from "@/lib/request-ctx";
import { clientIp } from "@/lib/session-cookie";
import { SITE_URL } from "@/lib/site";
import { throttle } from "@/lib/throttle";

/** Konfigurasi Meta Pixel (token tersamar). */
export const GET = withAdmin("integrasi.lihat", async () => {
  try {
    return NextResponse.json({ success: true, pixel: toAdminDTO(await getPixelConfig()) }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/pixel:GET", err);
  }
});

/** Simpan. Body: sebagian dari `{ enabled, pixelId, accessToken, clearAccessToken, testEventCode }`. */
export const PUT = withAdmin("integrasi.kelola", async (request, admin) => {
  const limit = throttle(`admin-pixel:${admin.userId}`, 20, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await savePixelConfig(admin.userId, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, pixel: result.pixel }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/pixel:PUT", err);
  }
});

/**
 * Kirim satu event uji (PageView) lewat Conversions API untuk memastikan token benar. Dengan Test Event Code,
 * event tampil di Events Manager > Test events dan tidak masuk ke data iklan.
 */
export const POST = withAdmin("integrasi.kelola", async (request, admin) => {
  const limit = throttle(`admin-pixel-test:${admin.userId}`, 6, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const res = await sendServerEvent({
      eventName: "PageView",
      eventId: `test-${randomUUID()}`,
      sourceUrl: `${SITE_URL}/admin/pixel`,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
    if (!res.ok) return jsonError(400, res.error ?? "Event uji gagal dikirim.");
    return NextResponse.json({ success: true, received: res.received ?? 0 }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/pixel:POST", err);
  }
});
