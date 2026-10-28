import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { reviewDraft } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Mengirim komentar bisa butuh beberapa detik (status container Threads). */
export const maxDuration = 60;

/**
 * Tinjau draf Auto Komentar (Editor+). Body: `{ id, action: "approve", text }` (teks boleh disunting; divalidasi
 * ulang di server, lalu semua batas diperiksa ulang secara atomik sebelum dikirim) atau `{ id, action: "reject" }`.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`acmt-review:${ctx.userId}`, 30, 10 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  const body = await readJson(request);
  try {
    const res = await reviewDraft(ctx, body);
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, status: res.status });
  } catch (err) {
    return autopilotError("autopilot/auto-comment/review:POST", err);
  }
});
