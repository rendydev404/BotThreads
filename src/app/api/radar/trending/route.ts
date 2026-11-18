import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";
import { isTrendCountry, isTrendId, trendPosts, trendingTopics } from "@/lib/threads-trending";

/**
 * Trending di Threads (fitur Meta "Threads Trending Topics"), hanya baca, tidak disimpan.
 * - `?country=ID|US` → daftar topik tren (cache server 1 jam, dipakai bersama semua pengguna). ID masih kosong
 *   di Threads → tren US dikirim sebagai cadangan (`fallbackFrom: "ID"`).
 * - `?trend=<trend_id>&type=top|recent` → posting untuk satu topik (cache 10 menit).
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  const sp = new URL(request.url).searchParams;
  const trend = sp.get("trend");
  try {
    if (trend !== null) {
      if (!isTrendId(trend)) return jsonError(400, "Topik tren tidak valid.");
      const perUser = throttle(`radar-trend-posts:${ctx.userId}`, 60, 10 * 60_000);
      if (!perUser.ok) return TOO_MANY(perUser.retryAfter);
      const res = await trendPosts(trend, sp.get("type") === "recent" ? "recent" : "top");
      if (!res.ok) return jsonError(res.status, res.error);
      return NextResponse.json({ success: true, ...res }, { headers: { "Cache-Control": "private, max-age=120" } });
    }

    const country = sp.get("country") ?? "ID";
    if (!isTrendCountry(country)) return jsonError(400, "Negara tren tidak didukung.");
    const res = await trendingTopics(country);
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, ...res }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return autopilotError("radar/trending:GET", err);
  }
});
