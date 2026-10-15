import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnWorkspace } from "@/lib/admin-service";
import { ADMIN_FORBIDDEN, withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/**
 * Tindakan atas satu workspace. Body: `{ action: "suspend", reason }` | `{ action: "unsuspend" }` |
 * `{ action: "member", identifier, role }` (identifier = email/username; role null = keluarkan).
 */
export const POST = withAdmin<{ id: string }>(null, async (request, admin, route) => {
  const { id } = await route.params;
  const limit = throttle(`admin-ws:${admin.userId}`, 60, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const body = await readJson(request);
    // Memasang paket adalah urusan modul Paket; tindakan lain urusan modul Workspace.
    const isPlan = typeof body === "object" && body !== null && (body as { action?: unknown }).action === "plan";
    if (!admin.can(isPlan ? "paket.kelola" : "workspace.kelola")) return ADMIN_FORBIDDEN();
    const result = await actOnWorkspace(admin.userId, id, body);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/workspaces:POST", err);
  }
});
