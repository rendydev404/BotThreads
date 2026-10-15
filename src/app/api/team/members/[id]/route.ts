import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY } from "@/lib/autopilot-api";
import { withCtx } from "@/lib/request-ctx";
import { createResetLink, removeTeamMember, updateMember } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

/** Ubah peran dan lingkup akun anggota. Body: `{ role, accountIds? }` (tanpa accountIds = semua akun). */
export const PATCH = withCtx<{ id: string }>("ADMIN", async (request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id anggota tidak valid.");
  try {
    const result = await updateMember(ctx, id, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return internalError("team/members:PATCH", err);
  }
});

/** Keluarkan anggota dari workspace (akun penggunanya sendiri tidak dihapus). */
export const DELETE = withCtx<{ id: string }>("ADMIN", async (_request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id anggota tidak valid.");
  try {
    const result = await removeTeamMember(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return internalError("team/members:DELETE", err);
  }
});

/** Buat tautan reset password untuk anggota (sekali pakai, 60 menit). Balasan memuat path tautannya. */
export const POST = withCtx<{ id: string }>("ADMIN", async (_request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id anggota tidak valid.");
  const limit = throttle(`team-reset:${ctx.userId}`, 20, 60 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await createResetLink(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true, path: result.path, expiresAt: result.expiresAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("team/members:POST", err);
  }
});
