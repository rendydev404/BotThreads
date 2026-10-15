import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { listMomentPage, saveMoment } from "@/lib/radar-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Momen kalender workspace yang belum lewat. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  try {
    return NextResponse.json(await listMomentPage(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("radar/moments:GET", err);
  }
});

/** Tambah atau ubah momen. Body: `{ id?, nama, mulai, selesai, catatan? }` (tanggal "YYYY-MM-DD"). */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`radar-moment:${ctx.userId}`, 30, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await saveMoment(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, id: result.moment.id, moment: result.moment });
  } catch (err) {
    return autopilotError("radar/moments:POST", err);
  }
});
