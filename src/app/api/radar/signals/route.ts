import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { addManualSignal, isSignalSource, listSignalPage } from "@/lib/radar-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Sinyal radar yang masih berlaku. Query: `source` (opsional), `cursor`. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const q = request.nextUrl.searchParams;
  const source = q.get("source");
  if (source && !isSignalSource(source)) return jsonError(400, "Sumber sinyal tidak valid.");
  const cursor = q.get("cursor");
  try {
    return NextResponse.json(await listSignalPage(ctx, { source: source && isSignalSource(source) ? source : null, cursor }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return autopilotError("radar/signals:GET", err);
  }
});

/** Tambah inspirasi manual. Body: `{ text, url? }`. */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`radar-signal:${ctx.userId}`, 30, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await addManualSignal(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return autopilotError("radar/signals:POST", err);
  }
});
