import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { ADMIN_TOO_MANY, NO_STORE, adminError } from "@/lib/admin-api";
import { actOnPost, listAllPosts } from "@/lib/admin-service";
import { withAdmin } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** Antrean (`scope=upcoming`) atau riwayat (`scope=history`) posting semua tenant. Query: `status`, `account`, `cursor`. */
export const GET = withAdmin("konten.lihat", async (request) => {
  const sp = request.nextUrl.searchParams;
  try {
    const result = await listAllPosts({ scope: sp.get("scope"), status: sp.get("status"), account: sp.get("account"), cursor: sp.get("cursor") });
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/content", err);
  }
});

/** Body: `{ action: "cancel" | "retry", postId }`. */
export const POST = withAdmin("konten.kelola", async (request, admin) => {
  const limit = throttle(`admin-content:${admin.userId}`, 60, 60_000);
  if (!limit.ok) return ADMIN_TOO_MANY(limit.retryAfter);
  try {
    const result = await actOnPost(admin.userId, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return adminError("admin/content:POST", err);
  }
});
