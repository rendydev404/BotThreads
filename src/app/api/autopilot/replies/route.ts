import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { autopilotError } from "@/lib/autopilot-api";
import { repliesPage, setReplyActive } from "@/lib/replies-service";
import { withCtx } from "@/lib/request-ctx";

/** Tab Komentar: saklar balas otomatis per akun + komentar terbaru dan balasannya. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    return NextResponse.json(await repliesPage(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("autopilot/replies:GET", err);
  }
});

/** Nyalakan/matikan balas komentar otomatis satu akun. Body: `{ accountId, aktif }`. */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const body = (await readJson(request)) as { accountId?: unknown; aktif?: unknown } | null;
  try {
    const res = await setReplyActive(ctx, body?.accountId, body?.aktif);
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("autopilot/replies:POST", err);
  }
});
