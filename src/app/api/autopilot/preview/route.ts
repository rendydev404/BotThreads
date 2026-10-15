import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { previewPlan } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/**
 * Pratinjau jam tayang besok untuk pengaturan yang belum disimpan. Body: `{ accountId, settings }`.
 * Murni perhitungan dari data jam ramai akun; tidak menulis apa pun.
 */
export const POST = withCtx("VIEWER", async (request, ctx) => {
  const body = (await readJson(request)) as { accountId?: unknown; settings?: unknown } | null;
  if (typeof body?.accountId !== "string" || !ID_PATTERN.test(body.accountId)) {
    return jsonError(400, "Id akun tidak valid.");
  }

  const limit = throttle(`autopilot-preview:${ctx.userId}`, 120, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  try {
    const result = await previewPlan(ctx, body.accountId, body.settings);
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result);
  } catch (err) {
    return autopilotError("autopilot/preview", err);
  }
});
