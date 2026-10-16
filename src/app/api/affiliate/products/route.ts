import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { saveProduct } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Tambah atau ubah produk katalog. Body: `{ id?, nama, link, niche, catatan?, aktif? }`. */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`affiliate-product:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await saveProduct(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, item: result.item });
  } catch (err) {
    return autopilotError("affiliate/products:POST", err);
  }
});
