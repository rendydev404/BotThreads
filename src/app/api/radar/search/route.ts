import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { getPublishAccountMap } from "@/lib/publish-accounts";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN, searchAsAccount, type SearchType } from "@/lib/threads-trends";

/**
 * Cari posting Threads dengan kata kunci memakai akun milik workspace (threads_keyword_search).
 * Body: `{ accountId, q, type: "TOP" | "RECENT" }`. Hasil hanya ditampilkan, tidak disimpan.
 * Batas Threads: 2.200 pencarian per akun per 24 jam; di sini dibatasi jauh di bawahnya.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const perUser = throttle(`radar-search:${ctx.userId}`, 20, 10 * 60_000);
  if (!perUser.ok) return TOO_MANY(perUser.retryAfter);

  const body = (await readJson(request)) as { accountId?: unknown; q?: unknown; type?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  const q = typeof body?.q === "string" ? body.q.trim().replace(/\s+/g, " ") : "";
  const type: SearchType = body?.type === "RECENT" ? "RECENT" : "TOP";
  if (!accountId) return jsonError(400, "Pilih akun Threads dulu.");
  if (q.length < SEARCH_QUERY_MIN || q.length > SEARCH_QUERY_MAX) {
    return jsonError(400, `Kata kunci ${SEARCH_QUERY_MIN}-${SEARCH_QUERY_MAX} karakter.`);
  }

  try {
    // Hanya akun dalam lingkup workspace/peran pengguna ini.
    if (!(await getPublishAccountMap([accountId])).has(accountId)) return jsonError(404, "Akun Threads tidak ditemukan.");
    const perAccount = throttle(`radar-search-acc:${accountId}`, 100, 60 * 60_000);
    if (!perAccount.ok) return TOO_MANY(perAccount.retryAfter);

    const found = await searchAsAccount(accountId, q, type);
    if (!found.ok) return jsonError(found.status, found.error);
    return NextResponse.json({ success: true, ...found.result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return autopilotError("radar/search:POST", err);
  }
});
