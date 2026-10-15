import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { listKnowledgePage, saveKnowledge } from "@/lib/radar-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Butir knowledge base (fakta, produk, promo, larangan) dalam lingkup pengguna. */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  try {
    return NextResponse.json(await listKnowledgePage(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("knowledge:GET", err);
  }
});

/** Tambah atau ubah butir. Body: `{ id?, accountId?, jenis, judul, isi, berlakuSampai? }`. */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`knowledge:${ctx.userId}`, 60, 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await saveKnowledge(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, id: result.item.id, item: result.item });
  } catch (err) {
    return autopilotError("knowledge:POST", err);
  }
});
