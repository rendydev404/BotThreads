import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { ideaMedia, type IdeaMediaAction } from "@/lib/idea-preview";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Mencari gambar (AI + baca artikel + unduh untuk diperiksa) bisa memakan puluhan detik. */
export const maxDuration = 60;

const ACTIONS: readonly IdeaMediaAction[] = ["ganti", "hapus"];

/**
 * Gambar preview satu ide: `{ action: "ganti" }` mencari gambar lain (atau menambah bila belum ada),
 * `{ action: "hapus" }` membuat postingan dari ide ini tanpa gambar. Hanya ide yang masih siap dipakai.
 */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id ide tidak valid.");
  const body = (await readJson(request)) as { action?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !ACTIONS.includes(action as IdeaMediaAction)) {
    return jsonError(400, 'Tindakan gambar tidak dikenal. Pakai "ganti" atau "hapus".');
  }
  // Mencari gambar mahal (AI + unduhan); menghapus murah.
  const limit = throttle(`idea-media:${ctx.userId}`, action === "ganti" ? 20 : 60, 5 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await ideaMedia(ctx, id, action as IdeaMediaAction, { signal: request.signal });
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, media: result.media }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("ideas/media:POST", err);
  }
});
