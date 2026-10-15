import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, autopilotError } from "@/lib/autopilot-api";
import { removeMoment } from "@/lib/radar-service";
import { withCtx } from "@/lib/request-ctx";

/** Hapus momen kalender beserta sinyalnya. */
export const DELETE = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id tidak valid.");
  try {
    const result = await removeMoment(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("radar/moments:DELETE", err);
  }
});
