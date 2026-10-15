import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { actOnIdea } from "@/lib/radar-service";
import type { IdeaAction } from "@/lib/radar-types";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

const ACTIONS: IdeaAction[] = ["pin", "unpin", "reject"];

/** Tindakan atas ide yang masih siap dipakai. Body: `{ action }` = pin (pakai di slot berikutnya) | unpin | reject. */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id ide tidak valid.");
  const body = (await readJson(request)) as { action?: unknown } | null;
  const action = body?.action as IdeaAction;
  if (!ACTIONS.includes(action)) return jsonError(400, "Tindakan tidak valid.");
  const limit = throttle(`idea-action:${ctx.userId}`, 120, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnIdea(ctx, id, action);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("ideas:POST", err);
  }
});
