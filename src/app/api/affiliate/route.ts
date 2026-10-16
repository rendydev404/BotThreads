import { NextResponse } from "next/server";
import { autopilotError } from "@/lib/autopilot-api";
import { affiliatePage } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";

/** Tab Affiliate: saklar workspace, pengaturan per akun, katalog produk, dan laporan 30 hari. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    return NextResponse.json(await affiliatePage(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("affiliate:GET", err);
  }
});
