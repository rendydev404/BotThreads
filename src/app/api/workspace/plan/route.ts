import { NextResponse } from "next/server";
import { internalError } from "@/lib/api-auth";
import { planLimits } from "@/lib/plan";
import { NO_WORKSPACE, withCtx } from "@/lib/request-ctx";

/** Paket workspace aktif dan pemakaiannya. Semua anggota boleh melihat. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    const limits = await planLimits(ctx.workspaceId === NO_WORKSPACE ? null : ctx.workspaceId);
    return NextResponse.json({ success: true, ...limits }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("workspace/plan", err);
  }
});
