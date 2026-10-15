import { NextResponse } from "next/server";
import { internalError, jsonError } from "@/lib/api-auth";
import { withCtx } from "@/lib/request-ctx";
import { getAudit } from "@/lib/team-service";

/** Catatan audit workspace (siapa mengubah apa), terbaru dulu. Query: `cursor`. */
export const GET = withCtx("ADMIN", async (request, ctx) => {
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    const result = await getAudit(ctx, cursor);
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("audit:GET", err);
  }
});
