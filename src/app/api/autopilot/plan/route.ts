import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, autopilotError } from "@/lib/autopilot-api";
import { getPlanView } from "@/lib/autopilot-plan-view";
import { withCtx } from "@/lib/request-ctx";

/**
 * Rencana posting autopilot satu hari: draf yang sudah ditulis dan perkiraan topik slot yang belum.
 * Query: `day=today|tomorrow` (bawaan today), `accountId` opsional.
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const q = request.nextUrl.searchParams;
  const day = q.get("day") === "tomorrow" ? "tomorrow" : "today";
  const accountId = q.get("accountId");
  if (accountId && !ID_PATTERN.test(accountId)) return jsonError(400, "Id akun tidak valid.");

  try {
    const result = await getPlanView(ctx, { day, accountId });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("autopilot/plan:GET", err);
  }
});
