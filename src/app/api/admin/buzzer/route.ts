import { NextResponse } from "next/server";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { jsonError, readJson } from "@/lib/api-auth";
import {
  actOnBuzzerCampaign,
  deployBuzzerCampaign,
  getBuzzerOverview,
  listBuzzerCampaigns,
  listBuzzerTargetPosts,
  previewBuzzerDrafts,
  runBuzzerQueue,
  saveBuzzerProfiles,
} from "@/lib/buzzer-service";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

export const maxDuration = 60;

/**
 * GET /api/admin/buzzer
 * - Default              : ringkasan workspace buzzer, akun buzzer + niche, akun target, dan statistik
 * - ?view=posts&accountId=... : daftar postingan terbaru akun target (DB + live Threads API)
 * - ?view=campaigns      : riwayat dan antrean kampanye pengerahan buzzer
 */
export const GET = withAdmin("buzzer.lihat", async (request, admin) => {
  const sp = request.nextUrl.searchParams;
  const view = sp.get("view");
  try {
    if (view === "posts") {
      const result = await listBuzzerTargetPosts(admin.userId, sp.get("accountId") ?? "", {
        includeLive: sp.get("live") !== "0",
      });
      if ("ok" in result) return jsonError(result.status, result.error);
      return NextResponse.json(result, { headers: NO_STORE });
    }
    if (view === "campaigns") {
      const result = await listBuzzerCampaigns(admin.userId, {
        status: sp.get("status"),
        cursor: sp.get("cursor"),
      });
      if ("ok" in result) return jsonError(result.status, result.error);
      return NextResponse.json(result, { headers: NO_STORE });
    }
    return NextResponse.json(await getBuzzerOverview(admin.userId), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/buzzer:GET", err);
  }
});

/**
 * POST /api/admin/buzzer
 * Body `kind`:
 * - "preview"         : susun pratinjau komentar / quote lintas-niche dengan AI
 * - "deploy"          : kerahkan buzzer ke postingan target
 * - "profile_save"    : simpan niche & persona akun buzzer
 * - "profile_ai"      : susun otomatis niche & persona akun buzzer lewat AI
 * - "campaign_action" : CANCEL | RETRY_FAILED | RUN_NOW pada kampanye
 * - "run_queue"       : proses antrean tugas buzzer yang jatuh tempo sekarang
 */
export const POST = withAdmin("buzzer.kelola", async (request, admin) => {
  const limit = throttle(`admin-buzzer:${admin.userId}`, 45, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);

  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError(400, "Data permintaan tidak valid.");
    }
    const kind = (body as { kind?: unknown }).kind;

    if (kind === "preview") {
      const result = await previewBuzzerDrafts(admin.userId, body);
      if ("ok" in result) return jsonError(result.status, result.error);
      return NextResponse.json(result, { headers: NO_STORE });
    }

    if (kind === "deploy") {
      const result = await deployBuzzerCampaign(admin.userId, body);
      if (!result.ok) return jsonError(result.status, result.error);
      return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
    }

    if (kind === "profile_save") {
      const result = await saveBuzzerProfiles(admin.userId, { ...body, mode: "upsert" });
      if (!result.ok) return jsonError(result.status, result.error);
      return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
    }

    if (kind === "profile_ai") {
      const result = await saveBuzzerProfiles(admin.userId, { ...body, mode: "ai_generate" });
      if (!result.ok) return jsonError(result.status, result.error);
      return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
    }

    if (kind === "campaign_action") {
      const cid = typeof (body as { campaignId?: unknown }).campaignId === "string" ? (body as { campaignId: string }).campaignId : "";
      const result = await actOnBuzzerCampaign(admin.userId, cid, body);
      if (!result.ok) return jsonError(result.status, result.error);
      return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
    }

    if (kind === "run_queue") {
      const forceAll = (body as { forceAll?: unknown }).forceAll !== false;
      const horizonMs = forceAll ? 24 * 60 * 60 * 1000 : 5_000;
      const res = await runBuzzerQueue({
        now: new Date(Date.now() + horizonMs),
        deadlineMs: Date.now() + 30_000,
      });
      return NextResponse.json({ success: true, ...res }, { headers: NO_STORE });
    }

    return jsonError(400, "Jenis tindakan buzzer tidak dikenal.");
  } catch (err) {
    return adminError("admin/buzzer:POST", err);
  }
});
