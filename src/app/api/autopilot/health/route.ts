import { NextResponse } from "next/server";
import { internalError } from "@/lib/api-auth";
import { getHealth } from "@/lib/notification-service";
import { withCtx } from "@/lib/request-ctx";

/** Riwayat tick autopilot (30 terakhir) dan ringkasan 24 jam: jumlah tick, galat, panggilan AI, durasi. */
export const GET = withCtx("ADMIN", async () => {
  try {
    return NextResponse.json(await getHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("autopilot/health", err);
  }
});
