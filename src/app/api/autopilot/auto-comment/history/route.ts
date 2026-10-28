import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { autopilotError } from "@/lib/autopilot-api";
import { autoCommentHistory } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";

/** Riwayat Auto Komentar, terbaru dulu, 30 per halaman (keyset `before`/`beforeId`). Filter `status`, `accountId`. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const p = request.nextUrl.searchParams;
  try {
    const res = await autoCommentHistory(ctx, {
      status: p.get("status"),
      accountId: p.get("accountId"),
      beforeAt: p.get("before"),
      beforeId: p.get("beforeId"),
    });
    if ("ok" in res) return jsonError(res.status, res.error);
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("autopilot/auto-comment/history:GET", err);
  }
});
