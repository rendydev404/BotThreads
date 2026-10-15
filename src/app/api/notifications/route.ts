import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN } from "@/lib/autopilot-api";
import { listNotifications, markNotificationsRead } from "@/lib/notification-service";
import { withCtx } from "@/lib/request-ctx";

/** Notifikasi dalam lingkup pengguna, terbaru dulu. Query: `cursor`. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    return NextResponse.json(await listNotifications(ctx, cursor), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("notifications:GET", err);
  }
});

/** Tandai dibaca. Body: `{ ids: string[] }` atau `{ all: true }`. */
export const POST = withCtx("VIEWER", async (request, ctx) => {
  const body = (await readJson(request)) as { ids?: unknown; all?: unknown } | null;
  let ids: string[] | null;
  if (body?.all === true) ids = null;
  else if (Array.isArray(body?.ids) && body.ids.length > 0 && body.ids.length <= 100 && body.ids.every((v) => typeof v === "string" && ID_PATTERN.test(v))) {
    ids = body.ids as string[];
  } else return jsonError(400, "Daftar notifikasi tidak valid.");
  try {
    return NextResponse.json({ success: true, updated: await markNotificationsRead(ctx, ids) });
  } catch (err) {
    return internalError("notifications:POST", err);
  }
});
