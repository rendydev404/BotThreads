import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/after-safe";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { getOnboarding, kickOnboarding } from "@/lib/account-onboarding";
import { withCtx } from "@/lib/request-ctx";
import { accountScope } from "@/lib/supabase";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/** Agen berjalan di `after()` dan ikut batas waktu route ini. */
export const maxDuration = 300;

/** Progres agen onboarding untuk akun-akun yang terlihat pengguna (dibaca panel agen tiap beberapa detik). */
export const GET = withCtx("VIEWER", async () => {
  try {
    const { visibleIds } = await accountScope();
    return NextResponse.json({ success: true, items: await getOnboarding(visibleIds) }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/onboarding:GET", err);
  }
});

/** Jalankan ulang agen untuk satu akun (riset tren + ide hari ini). Body: { accountId }. */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`onboarding:${ctx.userId}`, 6, 10 * 60_000);
  if (!limit.ok) return jsonError(429, "Agen baru saja dijalankan. Coba lagi beberapa menit lagi.");
  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const accountId = typeof body?.accountId === "string" ? body.accountId : "";
    if (!(await accountScope()).visibleIds.includes(accountId)) return jsonError(404, "Akun Threads tidak ditemukan.");
    const { workspaceId, userId } = ctx;
    afterResponse("onboarding", () => kickOnboarding(accountId, workspaceId, userId));
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/onboarding:POST", err);
  }
});
