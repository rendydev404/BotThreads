import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnWorkspace, deleteWorkspace, previewWorkspaceDelete } from "@/lib/admin-service";
import { ADMIN_FORBIDDEN, withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

const SUPER_ONLY = () => jsonError(403, "Hanya Super Admin yang boleh menghapus workspace.");

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

/** Dampak hapus workspace (akun, anggota, buzzer yang akan dilepas). Hanya Super Admin. */
export const GET = withAdmin<{ id: string }>(null, async (_request, admin, route) => {
  if (!admin.isSuper) return SUPER_ONLY();
  const { id } = await route.params;
  try {
    const result = await previewWorkspaceDelete(admin.userId, id);
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/workspaces:GET", err);
  }
});

/**
 * Hapus workspace permanen. Body: `{ confirm }` = nama workspace. Langkah pertama di database: putus dari semua
 * akun buzzer/sumber yang tertaut. Hanya Super Admin.
 */
export const DELETE = withAdmin<{ id: string }>(null, async (request, admin, route) => {
  if (!admin.isSuper) return SUPER_ONLY();
  const { id } = await route.params;
  const limit = throttle(`admin-ws-del:${admin.userId}`, 5, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await deleteWorkspace(admin.userId, id, await readJson(request));
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/workspaces:DELETE", err);
  }
});
