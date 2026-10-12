import { NextResponse, type NextRequest } from "next/server";
import { getRequestUserId, internalError, jsonError, readJson, UNAUTHORIZED } from "@/lib/api-auth";
import { parseRecommendBody } from "@/lib/content-validation";
import { recommendDrafts } from "@/lib/content-ai";
import type { RecommendResponse } from "@/lib/content-types";
import { getPublishAccountMap, reasonText } from "@/lib/publish-accounts";
import { throttle } from "@/lib/throttle";

/** Panggilan AI bisa memakan puluhan detik pada failover antar-model. */
export const maxDuration = 60;

/**
 * Rekomendasi draf. TIDAK PERNAH menulis ke antrean posting: hanya membaca data dan memanggil AI.
 */
export async function POST(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) return UNAUTHORIZED();

  const limit = throttle(`recommend:${userId}`, 20, 5 * 60_000);
  if (!limit.ok) {
    return jsonError(429, "Terlalu sering meminta rekomendasi. Coba lagi sebentar lagi.", undefined, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const body = await readJson(request);
  const parsed = parseRecommendBody(body);
  if (!parsed.ok) return jsonError(400, parsed.error);
  const input = parsed.value;

  try {
    const map = await getPublishAccountMap(input.accountIds);
    const accounts = [];
    for (const id of input.accountIds) {
      const a = map.get(id);
      if (!a) return jsonError(404, "Akun Threads tidak ditemukan.");
      if (!a.ready) {
        return jsonError(409, `@${a.username ?? a.displayName}: ${reasonText(a.reason) || "akun belum siap diposting"}.`);
      }
      accounts.push(a);
    }

    const result = await recommendDrafts({
      accounts,
      brief: input.brief,
      count: input.count,
      dayKey: input.date,
      avoid: input.avoid,
    });

    const payload: RecommendResponse = {
      success: true,
      drafts: result.drafts,
      ...(result.degraded || result.drafts.length === 0
        ? { degraded: result.degraded, message: "AI sedang tidak tersedia. Coba lagi sebentar lagi atau tulis draf manual." }
        : {}),
      meta: { model: result.model, latencyMs: result.latencyMs },
    };
    return NextResponse.json(payload);
  } catch (err) {
    return internalError("content/recommend", err);
  }
}
