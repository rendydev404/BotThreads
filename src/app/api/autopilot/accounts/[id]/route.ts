import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { kickOnboarding } from "@/lib/account-onboarding";
import { afterResponse } from "@/lib/after-safe";
import { saveSettings } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Agen riset (tren niche + ide + draf pertama) berjalan di `after()` dan ikut batas waktu route ini. */
export const maxDuration = 300;

/** Ubah pengaturan autopilot satu akun (mode, jumlah posting, jam, tema). Field yang tidak dikirim tidak berubah. */
export const PUT = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id akun tidak valid.");

  const limit = throttle(`autopilot-config:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  try {
    const body = await readJson(request);
    const result = await saveSettings(ctx, [id], body);
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    // Peran/tema, kategori topik, atau gaya sapaan benar-benar berubah (atau autopilot baru dinyalakan):
    // agen otomatis riset tren niche, menyusun ide baru (ide lama diganti), dan menyiapkan draf hari ini.
    if (result.research.includes(id)) {
      const { workspaceId, userId } = ctx;
      afterResponse("riset ulang", () => kickOnboarding(id, workspaceId, userId));
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("autopilot/accounts:PUT", err);
  }
});
