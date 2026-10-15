import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { autopilotError } from "@/lib/autopilot-api";
import { setAllActive } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Saklar "jeda semua": menghentikan (atau melanjutkan) penulisan dan antrean autopilot untuk seluruh
 * workspace. Body: `{ active }`. Posting yang sudah di antrean tidak ikut dibatalkan.
 */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const body = (await readJson(request)) as { active?: unknown } | null;
  if (typeof body?.active !== "boolean") return jsonError(400, "Nilai saklar tidak valid.");

  try {
    await setAllActive(ctx, body.active);
    return NextResponse.json({ success: true, active: body.active });
  } catch (err) {
    return autopilotError("autopilot/pause-all", err);
  }
});
