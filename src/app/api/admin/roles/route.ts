import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnRoles, getRoles } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Peran admin platform beserta izinnya dan staf yang memegangnya. Hanya Super Admin. */
export const GET = withAdmin("akses.lihat", async () => {
  try {
    return NextResponse.json(await getRoles(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/roles", err);
  }
});

/** Body: `{ action: "save", role: { id, nama, deskripsi, izin[] } }` | `{ action: "delete", id }`. */
export const POST = withAdmin("akses.kelola", async (request, admin) => {
  const limit = throttle(`admin-roles:${admin.userId}`, 30, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnRoles(admin, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/roles:POST", err);
  }
});
