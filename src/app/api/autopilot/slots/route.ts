import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, autopilotError } from "@/lib/autopilot-api";
import { listSlotPage } from "@/lib/autopilot-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Slot autopilot beserta drafnya. Query: `view=review` (menunggu tinjauan, jam terdekat dulu) atau
 * `view=history` (riwayat, terbaru dulu), `accountId` opsional, `cursor` untuk halaman berikutnya.
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const q = request.nextUrl.searchParams;
  const view = q.get("view") === "history" ? "history" : "review";
  const accountId = q.get("accountId");
  if (accountId && !ID_PATTERN.test(accountId)) return jsonError(400, "Id akun tidak valid.");
  const cursor = q.get("cursor");

  try {
    const result = await listSlotPage(ctx, { view, accountId, cursor });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("autopilot/slots:GET", err);
  }
});
