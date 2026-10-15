import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnUser } from "@/lib/admin-service";
import { withSuperAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/**
 * Tindakan atas satu pengguna. Body: `{ action: "ban", reason }` | `{ action: "unban" | "grant" |
 * "revoke" | "logout" | "reset" }`. `reset` membalas `path` tautan reset yang hanya ditampilkan sekali.
 */
export const POST = withSuperAdmin<{ id: string }>(async (request, admin, route) => {
  const { id } = await route.params;
  const limit = throttle(`admin-user:${admin.userId}`, 60, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnUser(admin.userId, id, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, ...(result.path ? { path: result.path, expiresAt: result.expiresAt } : {}) }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/users:POST", err);
  }
});
