import { NextResponse } from "next/server";
import { autopilotError } from "@/lib/autopilot-api";
import { autoCommentOverview } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";

/** Tab Auto Komentar: aturan workspace, pengaturan per akun, antrean tinjau, dan hitungan 7 hari. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    return NextResponse.json(await autoCommentOverview(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("autopilot/auto-comment:GET", err);
  }
});
