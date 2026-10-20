import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { googleConfigured } from "@/lib/google-oauth";
import { planLimits } from "@/lib/plan";
import { listPublishAccounts } from "@/lib/publish-accounts";
import { NO_WORKSPACE, ROLE_LABEL, withCtx } from "@/lib/request-ctx";
import { setSessionCookie } from "@/lib/session-cookie";
import { db, must } from "@/lib/supabase";
import { changeOwnPassword, switchWorkspace } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

/** Profil pengguna yang sedang masuk: nama, peran, workspace aktif, dan workspace lain yang bisa dipilih. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    const hasWorkspace = !!ctx.workspaceId && ctx.workspaceId !== NO_WORKSPACE;
    const [user, accountCount, planExpired] = await Promise.all([
      must<{ username: string; name: string | null; email: string | null } | null>(
        db().from("DashboardUser").select("username, name, email").eq("id", ctx.userId).maybeSingle()
      ),
      // Dari cache daftar akun (60 dtk) yang juga dipakai halaman lain; gagal memuatnya tidak menggagalkan profil.
      listPublishAccounts().then(
        (rows) => rows.length,
        () => null
      ),
      // Paket habis masa berlaku (cache paket 30 dtk); gagal memuatnya tidak menggagalkan profil.
      hasWorkspace
        ? planLimits(ctx.workspaceId).then(
            (l) => (l.kedaluwarsa ? { nama: l.plan?.nama ?? null, berakhir: l.berakhir } : null),
            () => null
          )
        : null,
    ]);
    return NextResponse.json(
      {
        success: true,
        user: { id: ctx.userId, username: user?.username ?? "", name: user?.name ?? null, email: user?.email ?? null },
        role: ctx.role,
        roleLabel: ROLE_LABEL[ctx.role],
        workspaceId: ctx.workspaceId === NO_WORKSPACE ? null : ctx.workspaceId,
        /** Skema multi-user terpasang (peran dan pembatasan akun berlaku). */
        multiUser: ctx.workspaceId !== null,
        hasAccess: ctx.workspaceId !== NO_WORKSPACE,
        superadmin: ctx.superadmin === true,
        /** Peran dan izin konsol admin platform; null bila bukan staf. */
        admin: ctx.admin ?? null,
        suspended: ctx.suspended ?? null,
        announcement: ctx.announcement ?? null,
        accountScoped: ctx.accountIds !== null,
        accountCount,
        planExpired,
        workspaces: ctx.workspaces ?? [],
        google: googleConfigured(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return internalError("auth/me", err);
  }
});

/**
 * Ubah milik sendiri. Body: `{ action: "password", current, next }` (ganti password; sesi diterbitkan
 * ulang) atau `{ action: "workspace", workspaceId }` (pindah workspace aktif).
 */
export const POST = withCtx("VIEWER", async (request, ctx) => {
  const body = (await readJson(request)) as { action?: unknown; workspaceId?: unknown } | null;
  try {
    if (body?.action === "workspace") {
      const result = await switchWorkspace(ctx, body.workspaceId);
      if (!result.ok) return jsonError(result.status, result.error);
      return NextResponse.json({ success: true });
    }
    if (body?.action === "password") {
      const limit = throttle(`password:${ctx.userId}`, 5, 15 * 60_000);
      if (!limit.ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.", undefined, { "Retry-After": String(limit.retryAfter) });
      const result = await changeOwnPassword(ctx, body);
      if (!result.ok) return jsonError(result.status, result.error);
      const res = NextResponse.json({ success: true });
      await setSessionCookie(res, request, result.session.userId, result.session.passwordHash);
      return res;
    }
    return jsonError(400, "Tindakan tidak valid.");
  } catch (err) {
    return internalError("auth/me:POST", err);
  }
});
