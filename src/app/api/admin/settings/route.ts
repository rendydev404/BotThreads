import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { getSettings, saveSettings } from "@/lib/admin-service";
import { withSuperAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Saklar platform: pendaftaran mandiri, autopilot global, dan pengumuman. */
export const GET = withSuperAdmin(async () => {
  try {
    return NextResponse.json(await getSettings(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/settings", err);
  }
});

/** Ubah saklar platform. Body: sebagian dari `{ signupOpen, autopilotGlobal, announcement }`. */
export const PUT = withSuperAdmin(async (request, admin) => {
  const limit = throttle(`admin-settings:${admin.userId}`, 30, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await saveSettings(admin.userId, await readJson(request));
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/settings:PUT", err);
  }
});
