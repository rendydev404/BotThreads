import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { withCtx, type RequestCtx } from "@/lib/request-ctx";
import { db, must } from "@/lib/supabase";
import { startThreadsAuthorize, threadsStartErrorText } from "@/lib/threads-oauth-start";
import { decidePairing, isPairingId, pairingById } from "@/lib/threads-pairing";

const NO_STORE = { "Cache-Control": "no-store" };

const workspaceNameOf = (ctx: RequestCtx): string =>
  ctx.workspaces?.find((w) => w.workspaceId === ctx.workspaceId)?.nama ?? "workspace ini";

/** HP yang men-scan QR (Pemilik/Admin): `?id=` -> status pairing + workspace tujuan. */
export const GET = withCtx("ADMIN", async (request, ctx) => {
  const id = request.nextUrl.searchParams.get("id");
  if (!isPairingId(id)) return jsonError(400, "QR tidak valid.");
  const p = pairingById(id);
  if (!p) return jsonError(410, "QR sudah kedaluwarsa. Buat QR baru di komputer.");
  return NextResponse.json(
    { success: true, status: p.status, expiresAt: new Date(p.expiresAt).toISOString(), workspaceName: workspaceNameOf(ctx) },
    { headers: NO_STORE }
  );
});

/** Body `{ id, action: "setujui" | "tolak" }`. Menyetujui dicek dulu dengan aturan yang sama seperti tombol Hubungkan. */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const body = (await readJson(request)) as { id?: unknown; action?: unknown } | null;
  if (!isPairingId(body?.id)) return jsonError(400, "QR tidak valid.");
  if (body.action !== "setujui" && body.action !== "tolak") return jsonError(400, "Tindakan tidak valid.");
  const id = body.id;

  try {
    let result: ReturnType<typeof decidePairing>;
    if (body.action === "tolak") {
      result = decidePairing(id, { approve: false });
    } else {
      if (!pairingById(id)) return jsonError(410, "QR sudah kedaluwarsa. Buat QR baru di komputer.");
      // Kuota, paket, dan konfigurasi dicek sekarang, supaya penolakan muncul di HP, bukan setelah login Threads.
      const check = await startThreadsAuthorize(request, ctx);
      if (check.error !== null) return jsonError(409, threadsStartErrorText(check.error));
      const user = await must<{ username: string; name: string | null } | null>(
        db().from("DashboardUser").select("username, name").eq("id", ctx.userId).maybeSingle()
      );
      result = decidePairing(id, {
        approve: true,
        approval: {
          userId: ctx.userId,
          workspaceId: ctx.workspaceId as string,
          workspaceName: workspaceNameOf(ctx),
          approverName: user?.name || user?.username || "Admin",
        },
      });
    }
    if (result === "NOT_FOUND") return jsonError(410, "QR sudah kedaluwarsa. Buat QR baru di komputer.");
    if (result === "DECIDED") return jsonError(409, "QR ini sudah diputuskan sebelumnya.");
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/pair/confirm", err);
  }
});
