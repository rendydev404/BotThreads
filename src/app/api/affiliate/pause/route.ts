import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { autopilotError } from "@/lib/autopilot-api";
import { setAffiliateActive } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Saklar "jeda semua affiliate" workspace. Body: `{ active }`. Saat dijeda, slot baru ditulis sebagai
 * postingan biasa; balasan berisi link untuk postingan yang sudah diantre tetap dikirim.
 */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const body = (await readJson(request)) as { active?: unknown } | null;
  if (typeof body?.active !== "boolean") return jsonError(400, "Nilai saklar tidak valid.");
  try {
    const result = await setAffiliateActive(ctx, body.active);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, active: body.active });
  } catch (err) {
    return autopilotError("affiliate/pause", err);
  }
});
