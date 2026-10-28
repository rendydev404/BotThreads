import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { autopilotError } from "@/lib/autopilot-api";
import { saveAccountSettings, saveWorkspaceConfig } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";

/**
 * Simpan pengaturan Auto Komentar.
 * - `{ scope: "workspace", aktif, gapMinutes, cooldownDays, maxPostAgeHours, blockList }` (Admin/Pemilik)
 * - `{ scope: "account", accountId, mode, slots, keywords, dailyCap }` (Editor; mode Otomatis hanya Admin/Pemilik)
 * Peran diperiksa di layanan, bukan hanya di UI.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const body = (await readJson(request)) as ({ scope?: unknown; accountId?: unknown } & Record<string, unknown>) | null;
  if (!body) return jsonError(400, "Permintaan tidak valid.");
  try {
    if (body.scope === "workspace") {
      const res = await saveWorkspaceConfig(ctx, body);
      if (!res.ok) return jsonError(res.status, res.error);
      return NextResponse.json({ success: true, config: res.config });
    }
    if (body.scope === "account") {
      const res = await saveAccountSettings(ctx, body.accountId, body);
      if (!res.ok) return jsonError(res.status, res.error);
      return NextResponse.json({ success: true });
    }
    return jsonError(400, "Permintaan tidak valid.");
  } catch (err) {
    return autopilotError("autopilot/auto-comment/settings:POST", err);
  }
});
