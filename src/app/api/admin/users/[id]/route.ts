import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnUser } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/**
 * Tindakan atas satu pengguna. Body: `{ action: "ban", reason }` | `{ action: "unban" | "logout" | "reset" }` |
 * `{ action: "update", name?, email? }` | `{ action: "role", role | null }` (Super Admin) | `{ action: "grant" | "revoke" }`
 * (Super Admin). `reset` membalas `path` tautan reset yang hanya ditampilkan sekali.
 */
export const POST = withAdmin<{ id: string }>("pengguna.kelola", async (request, admin, route) => {
  const { id } = await route.params;
  const limit = throttle(`admin-user:${admin.userId}`, 60, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnUser(admin, id, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, ...(result.path ? { path: result.path, expiresAt: result.expiresAt } : {}) }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/users:POST", err);
  }
});
