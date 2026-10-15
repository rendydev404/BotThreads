import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { saveSettings } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

const MAX_ACCOUNTS = 200;

/** Terapkan perubahan pengaturan (biasanya mode) ke banyak akun sekaligus. Body: `{ accountIds, settings }`. */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const body = (await readJson(request)) as { accountIds?: unknown; settings?: unknown } | null;
  const ids = body?.accountIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_ACCOUNTS ||
    !ids.every((v) => typeof v === "string" && ID_PATTERN.test(v))
  ) {
    return jsonError(400, `Daftar akun tidak valid (1-${MAX_ACCOUNTS}).`);
  }

  const limit = throttle(`autopilot-bulk:${ctx.userId}`, 10, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);

  try {
    const result = await saveSettings(ctx, [...new Set(ids as string[])], body?.settings);
    if (!result.ok) return jsonError(result.status, result.error, result.details);
    return NextResponse.json({ success: true, saved: result.saved, skipped: result.skipped });
  } catch (err) {
    return autopilotError("autopilot/bulk", err);
  }
});
