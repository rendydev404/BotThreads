import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { ID_PATTERN, autopilotError } from "@/lib/autopilot-api";
import { removeProduct } from "@/lib/affiliate-service";
import { withCtx } from "@/lib/request-ctx";

/** Hapus produk katalog; balasan berisi link produk ini yang belum terkirim ikut dibatalkan. */
export const DELETE = withCtx<{ id: string }>("EDITOR", async (_request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id tidak valid.");
  try {
    const result = await removeProduct(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return autopilotError("affiliate/products:DELETE", err);
  }
});
