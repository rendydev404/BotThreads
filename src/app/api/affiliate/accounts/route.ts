import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { saveAffiliateSettings } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Atur affiliate satu atau banyak akun sekaligus. Body: `{ accountIds, settings }` (perubahan sebagian). */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`affiliate-accounts:${ctx.userId}`, 20, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  const body = (await readJson(request)) as { accountIds?: unknown; settings?: unknown } | null;
  try {
    const result = await saveAffiliateSettings(ctx, body?.accountIds, body?.settings);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, saved: result.saved });
  } catch (err) {
    return autopilotError("affiliate/accounts", err);
  }
});
