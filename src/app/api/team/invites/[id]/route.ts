import { NextResponse } from "next/server";
import { internalError, jsonError } from "@/lib/api-auth";
import { ID_PATTERN } from "@/lib/autopilot-api";
import { withCtx } from "@/lib/request-ctx";
import { cancelInvite } from "@/lib/team-service";

/** Cabut undangan yang belum diterima (tautannya langsung tidak berlaku). */
export const DELETE = withCtx<{ id: string }>("ADMIN", async (_request, ctx, route) => {
  const { id } = await route.params;
  if (!ID_PATTERN.test(id)) return jsonError(400, "Id undangan tidak valid.");
  try {
    const result = await cancelInvite(ctx, id);
    if (!result.ok) return jsonError(result.status, result.error);
    return NextResponse.json({ success: true });
  } catch (err) {
    return internalError("team/invites:DELETE", err);
  }
});
