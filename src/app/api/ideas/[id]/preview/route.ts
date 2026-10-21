import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { ideaPreview } from "@/lib/idea-preview";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Panggilan AI bisa memakan puluhan detik pada failover antar-model. */
export const maxDuration = 60;

/**
 * Preview postingan dari satu ide. Preview yang sudah tersimpan dikembalikan tanpa memanggil AI;
 * `{ regenerate: true }` meminta AI menulis versi baru.
 */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id ide tidak valid.");
  const body = (await readJson(request)) as { regenerate?: unknown } | null;
  const regenerate = body?.regenerate === true;
  // Hanya penulisan baru yang dihitung mahal; membaca preview tersimpan tidak dibatasi seketat itu.
  const limit = throttle(`idea-preview:${ctx.userId}`, regenerate ? 20 : 60, 5 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await ideaPreview(ctx, id, { regenerate, signal: request.signal });
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, preview: result.preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("ideas/preview:POST", err);
  }
});
