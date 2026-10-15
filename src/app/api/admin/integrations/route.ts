import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { appOrigin } from "@/lib/google-oauth";
import { getPublicIntegrations, getRawIntegrations, saveIntegrations } from "@/lib/integrations";
import { withAdmin } from "@/lib/request-ctx";
import { threadsTokenKeyStatus } from "@/lib/threads-connect";
import { throttle } from "@/lib/throttle";

export const GET = withAdmin("integrasi.lihat", async (request) => {
  try {
    const cfg = await getRawIntegrations();
    const [integrations, tokenKey] = await Promise.all([
      getPublicIntegrations(appOrigin(request, cfg.googleOauth.appUrl)),
      threadsTokenKeyStatus(),
    ]);
    return NextResponse.json({ success: true, integrations, tokenKey }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/integrations:GET", err);
  }
});

export const PUT = withAdmin("integrasi.kelola", async (request, admin) => {
  const limit = throttle(`admin-integrations:${admin.userId}`, 20, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const cfg = await getRawIntegrations();
    const result = await saveIntegrations(admin.userId, await readJson(request), appOrigin(request, cfg.googleOauth.appUrl));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json(
      { success: true, integrations: result.integrations, tokenKey: await threadsTokenKeyStatus() },
      { headers: NO_STORE }
    );
  } catch (err) {
    return adminError("admin/integrations:PUT", err);
  }
});
