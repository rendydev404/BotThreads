import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { retryReply } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Kirim ulang balasan berisi link affiliate yang gagal; publisher mengirimnya di putaran berikutnya. */
export const POST = withCtx<{ id: string }>("EDITOR", async (_request, ctx, route) => {
  const limit = throttle(`affiliate-retry:${ctx.userId}`, 20, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id tidak valid.");
  try {
    const result = await retryReply(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("affiliate/replies:retry", err);
  }
});
