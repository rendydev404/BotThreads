import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { addManualLesson, deleteLesson, listLessons } from "@/lib/account-memory";
import { suggestProfile } from "@/lib/account-onboarding";
import { getPublishAccountMap } from "@/lib/publish-accounts";
import { loadIdeaContext } from "@/lib/radar-store";
import { withCtx } from "@/lib/request-ctx";
import { accountScope, db } from "@/lib/supabase";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/** Profil AI disusun AI bisa memakan beberapa detik pada failover antar-model. */
export const maxDuration = 60;

const visible = async (id: unknown): Promise<string | null> =>
  typeof id === "string" && (await accountScope()).visibleIds.includes(id) ? id : null;

/**
 * Bagian Profil AI yang bukan pengaturan autopilot: pelajaran gaya yang dipelajari AI dari koreksi pemilik
 * akun. (Peran, gaya sapaan, dan kategori topik disimpan lewat PUT /api/autopilot/accounts/[id].)
 */
export const GET = withCtx("VIEWER", async (request) => {
  try {
    const id = await visible(request.nextUrl.searchParams.get("accountId"));
    if (!id) return jsonError(404, "Akun Threads tidak ditemukan.");
    const [lessons, config] = await Promise.all([
      listLessons(id),
      db().from("AutopilotConfig").select("brief, voiceStyle, pillars").eq("accountId", id).maybeSingle(),
    ]);
    const c = (config.data ?? null) as { brief: string | null; voiceStyle: string | null; pillars: { key: string; bobot: number }[] | null } | null;
    const profile = { brief: c?.brief ?? null, voiceStyle: c?.voiceStyle ?? null, pillars: c?.pillars ?? [] };
    return NextResponse.json({ success: true, profile, lessons }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/ai-profile:GET", err);
  }
});

/**
 * Body: { accountId, action: "suggest" } -> Profil AI disusun AI dari postingan akun (tidak disimpan);
 *       { accountId, action: "lesson", text } -> tambah aturan gaya tulisan sendiri.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`ai-profile:${ctx.userId}`, 20, 5 * 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu sering. Coba lagi sebentar lagi.");
  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const id = await visible(body?.accountId);
    if (!id) return jsonError(404, "Akun Threads tidak ditemukan.");

    if (body?.action === "lesson") {
      const text = typeof body.text === "string" ? body.text : "";
      const lesson = await addManualLesson(id, ctx.workspaceId, text);
      if (!lesson) return jsonError(400, "Tulis aturan gaya minimal 3 karakter.");
      return NextResponse.json({ success: true, lesson }, { headers: NO_STORE });
    }
    if (body?.action === "suggest") {
      const now = new Date();
      const [account, context] = await Promise.all([
        getPublishAccountMap([id]).then((m) => m.get(id)),
        loadIdeaContext([id], now),
      ]);
      const suggestion = await suggestProfile(account?.username ?? null, context.recents.get(id) ?? []);
      if (!suggestion) return jsonError(422, "Postingan akun belum cukup untuk disimpulkan AI. Tulis Profil AI secara manual dulu.");
      return NextResponse.json({ success: true, suggestion }, { headers: NO_STORE });
    }
    return jsonError(400, "Aksi tidak dikenal.");
  } catch (err) {
    return internalError("threads/ai-profile:POST", err);
  }
});

/** Hapus satu pelajaran gaya. Body: { accountId, lessonId }. */
export const DELETE = withCtx("EDITOR", async (request) => {
  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const id = await visible(body?.accountId);
    if (!id || typeof body?.lessonId !== "string") return jsonError(404, "Pelajaran tidak ditemukan.");
    const ok = await deleteLesson(id, body.lessonId);
    return ok ? NextResponse.json({ success: true }, { headers: NO_STORE }) : jsonError(404, "Pelajaran tidak ditemukan.");
  } catch (err) {
    return internalError("threads/ai-profile:DELETE", err);
  }
});
