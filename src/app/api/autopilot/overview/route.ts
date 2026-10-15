import { NextResponse } from "next/server";
import { internalError } from "@/lib/api-auth";
import { getOverview } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";

/** Ringkasan autopilot: mode per akun, slot hari ini dan besok, kesehatan penjadwal. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  try {
    return NextResponse.json(await getOverview(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("autopilot/overview", err);
  }
});
