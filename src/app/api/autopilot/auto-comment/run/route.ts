import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { runAccountNow } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** <= 2 pencarian + <= 3 draf AI + kirim. */
export const maxDuration = 120;

/**
 * "Jalankan sekarang" untuk satu akun (Editor+). Body: `{ accountId }`. Semua batas tetap berlaku (saklar,
 * batas harian, jeda, cooldown penulis); mode Tinjau menghasilkan draf, mode Otomatis mengirim.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const body = (await readJson(request)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return jsonError(400, "Pilih akun Threads dulu.");
  const perUser = throttle(`acmt-run:${ctx.userId}`, 6, 10 * 60_000);
  if (!perUser.ok) return TOO_MANY(perUser.retryAfter);
  const perAccount = throttle(`acmt-run-acc:${accountId}`, 3, 10 * 60_000);
  if (!perAccount.ok) return TOO_MANY(perAccount.retryAfter);
  try {
    const res = await runAccountNow(ctx, accountId);
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, note: res.result.note, outcome: res.result.outcome });
  } catch (err) {
    return autopilotError("autopilot/auto-comment/run:POST", err);
  }
});
