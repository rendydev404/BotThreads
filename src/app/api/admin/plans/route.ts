import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnPlans, adminPlans } from "@/lib/plan";
import { withSuperAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Semua paket (termasuk yang nonaktif) beserta jumlah workspace pemakainya. */
export const GET = withSuperAdmin(async () => {
  try {
    return NextResponse.json(await adminPlans(), { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/plans", err);
  }
});

/** Body: `{ action: "save", plan }` | `{ action: "delete", id }` | `{ action: "default", id | null }`. */
export const POST = withSuperAdmin(async (request, admin) => {
  const limit = throttle(`admin-plans:${admin.userId}`, 30, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnPlans(admin.userId, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/plans:POST", err);
  }
});
