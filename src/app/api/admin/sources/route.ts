import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { linkSource, listSources } from "@/lib/admin-service";
import { withSuperAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Workspace SukaPost (tempat akun Threads berada) dan tenant dashboard tempat masing-masing ditautkan. */
export const GET = withSuperAdmin(async () => {
  try {
    return NextResponse.json(await listSources(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/sources", err);
  }
});

/** Tautkan atau lepas sebuah workspace SukaPost. Body: `{ workspaceId, tenantId | null }`. */
export const POST = withSuperAdmin(async (request, admin) => {
  const limit = throttle(`admin-source:${admin.userId}`, 30, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await linkSource(admin.userId, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/sources:POST", err);
  }
});
