import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { EDIT_ACTIONS, editCandidates, type EditAction } from "@/lib/content-ai";
import { topicContainment } from "@/lib/autopilot-ideas";
import { getPublishAccountMap } from "@/lib/publish-accounts";
import { ideaCandidates } from "@/lib/radar-store";
import { withCtx } from "@/lib/request-ctx";
import { loadScopedPost } from "@/lib/threads-publish";
import { throttle } from "@/lib/throttle";

/** Panggilan AI bisa memakan puluhan detik pada failover antar-model. */
export const maxDuration = 60;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 2000;

/**
 * Edit dengan AI untuk satu postingan terjadwal: beberapa versi baru (lebih manusiawi, hook lebih kuat,
 * lebih singkat, lebih santai, arahan bebas, atau ide baru dari bank ide/tren akun). TIDAK menyimpan apa pun;
 * versi yang dipilih disimpan lewat PATCH biasa. Body: { action, instruction?, text? }.
 */
export const POST = withCtx<{ id: string }>("EDITOR", async (request, ctx, route) => {
  const limit = throttle(`ai-edit:${ctx.userId}`, 30, 5 * 60_000);
  if (!limit.ok) {
    return jsonError(429, "Terlalu sering meminta AI. Coba lagi sebentar lagi.", undefined, { "Retry-After": String(limit.retryAfter) });
  }

  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id postingan tidak valid.");

  const body = (await readJson(request)) as Record<string, unknown> | null;
  const action = body?.action;
  if (typeof action !== "string" || !EDIT_ACTIONS.includes(action as EditAction)) return jsonError(400, "Aksi AI tidak dikenal.");
  const instruction = typeof body?.instruction === "string" ? body.instruction.slice(0, 300) : null;
  const draftText = typeof body?.text === "string" && body.text.trim() ? body.text.slice(0, MAX_TEXT) : null;

  try {
    const post = await loadScopedPost(id);
    const accountId = post?.dispatch?.threadsAccountId;
    if (!post || !accountId) return jsonError(404, "Postingan tidak ditemukan.");
    const account = (await getPublishAccountMap([accountId])).get(accountId);
    if (!account) return jsonError(404, "Akun Threads postingan ini tidak ditemukan.");

    // Teks di editor (mungkin belum disimpan) lebih baru daripada yang ada di database.
    const text = draftText ?? post.caption;
    const now = new Date();
    let idea: { topik: string; sudut: string | null } | null = null;
    if (action === "idea") {
      // Ide teratas bank ide akun (hasil riset tren niche), selain topik yang sedang dibahas teks ini.
      const ideas = ((await ideaCandidates([accountId], now, 6).catch(() => new Map())).get(accountId) ?? []).filter(
        (i: { topik: string }) => topicContainment(i.topik, text) < 0.5
      );
      const pick = ideas[Math.floor(Math.random() * Math.min(3, ideas.length))];
      idea = pick ? { topik: pick.topik, sudut: pick.sudut } : null;
    }

    const res = await editCandidates({ account, text, action: action as EditAction, instruction, idea, signal: request.signal }, now);
    if (!res.ok) return jsonError(502, res.error);
    return NextResponse.json({ success: true, ...res.result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("content/posts/[id]/ai:POST", err);
  }
});
