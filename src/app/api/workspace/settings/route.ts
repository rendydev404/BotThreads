import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { FORBIDDEN, hasRole, withCtx } from "@/lib/request-ctx";
import { getSettings, saveSettings } from "@/lib/team-service";

/** Pengaturan workspace: nama dan deskripsi brand (dipakai prompt AI) dan topik terlarang. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    const result = await getSettings(ctx);
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("workspace/settings:GET", err);
  }
});

/** Simpan pengaturan workspace. Body: `{ namaBrand, deskripsiBrand?, topikTerlarang? }`. */
export const PUT = withCtx("VIEWER", async (request, ctx) => {
  if (!hasRole(ctx, "ADMIN")) return FORBIDDEN();
  try {
    const result = await saveSettings(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, settings: result.settings });
  } catch (err) {
    return internalError("workspace/settings:PUT", err);
  }
});
