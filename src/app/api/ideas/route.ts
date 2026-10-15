import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, autopilotError } from "@/lib/autopilot-api";
import { isIdeaView, listIdeaPage } from "@/lib/radar-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Bank ide. Query: `view=ready` (siap dipakai, bawaan) | `used` | `dropped`, `accountId` opsional,
 * `cursor` untuk halaman berikutnya.
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const q = request.nextUrl.searchParams;
  const view = q.get("view") ?? "ready";
  if (!isIdeaView(view)) return jsonError(400, "Tampilan ide tidak valid.");
  const accountId = q.get("accountId");
  if (accountId && !ID_PATTERN.test(accountId)) return jsonError(400, "Id akun tidak valid.");
  const cursor = q.get("cursor");
  try {
    const result = await listIdeaPage(ctx, { view, accountId, cursor });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("ideas:GET", err);
  }
});
