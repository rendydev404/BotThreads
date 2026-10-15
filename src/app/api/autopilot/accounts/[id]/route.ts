import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { saveSettings } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Ubah pengaturan autopilot satu akun (mode, jumlah posting, jam, tema). Field yang tidak dikirim tidak berubah. */
export const PUT = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id akun tidak valid.");

  const limit = throttle(`autopilot-config:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  try {
    const result = await saveSettings(ctx, [id], await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("autopilot/accounts:PUT", err);
  }
});
