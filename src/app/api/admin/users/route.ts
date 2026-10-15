import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-auth";
import { NO_STORE, adminError } from "@/lib/admin-api";
import { listUsers } from "@/lib/admin-service";
import { withSuperAdmin } from "@/lib/request-ctx";

/** Semua pengguna, terbaru dulu. Query: `q` (cari username/email/nama), `status`, `cursor`. */
export const GET = withSuperAdmin(async (request, admin) => {
  const sp = request.nextUrl.searchParams;
  try {
    const result = await listUsers(admin.userId, { q: sp.get("q"), status: sp.get("status"), cursor: sp.get("cursor") });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/users", err);
  }
});
