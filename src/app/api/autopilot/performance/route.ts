import { NextResponse } from "next/server";
import { internalError, jsonError } from "@/lib/api-auth";
import { ID_PATTERN } from "@/lib/autopilot-api";
import { getPerformance } from "@/lib/notification-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Hasil belajar autopilot 60 hari: formula pembuka, pilar, jam, dan jenis slot mana yang paling
 * berhasil, serta perbandingan posting autopilot dengan posting lain. Query: `accountId` opsional.
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (accountId && !ID_PATTERN.test(accountId)) return jsonError(400, "Id akun tidak valid.");
  try {
    const result = await getPerformance(ctx, accountId);
    if (!result) return jsonError(404, "Akun Threads tidak ditemukan.");
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    return internalError("autopilot/performance", err);
  }
});
