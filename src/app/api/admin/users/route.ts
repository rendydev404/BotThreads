import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { createUser, listUsers } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Semua pengguna, terbaru dulu. Query: `q` (cari username/email/nama), `status`, `cursor`. */
export const GET = withAdmin("pengguna.lihat", async (request, admin) => {
  const sp = request.nextUrl.searchParams;
  try {
    const result = await listUsers(admin.userId, { q: sp.get("q"), status: sp.get("status"), cursor: sp.get("cursor") });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/users", err);
  }
});

/** Buat akun pengguna. Body: `{ username, email?, name?, password, role? }` (`role` hanya oleh Super Admin). */
export const POST = withAdmin("pengguna.kelola", async (request, admin) => {
  const limit = throttle(`admin-user-create:${admin.userId}`, 20, 60 * 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await createUser(admin, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, id: result.id }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return adminError("admin/users:POST", err);
  }
});
