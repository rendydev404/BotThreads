import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY } from "@/lib/autopilot-api";
import { withCtx } from "@/lib/request-ctx";
import { getTeam, inviteMember } from "@/lib/team-service";
import { throttle } from "@/lib/throttle";

/** Anggota workspace beserta peran dan lingkup akunnya, dan undangan yang belum diterima. */
export const GET = withCtx("ADMIN", async (_request, ctx) => {
  try {
    const result = await getTeam(ctx);
    if ("ok" in result) return jsonError(result.status, result.error);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError("team:GET", err);
  }
});

/**
 * Undang anggota. Body: `{ email, role: ADMIN|EDITOR|VIEWER, accountIds? }` (tanpa accountIds = semua akun).
 * Balasan memuat path tautan undangan yang hanya ditampilkan sekali; admin yang mengirimkannya.
 */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const limit = throttle(`team-invite:${ctx.userId}`, 20, 60 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const result = await inviteMember(ctx, await readJson(request));
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json(
      { success: true, path: result.path, expiresAt: result.expiresAt, invite: result.invite },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return internalError("team:POST", err);
  }
});
