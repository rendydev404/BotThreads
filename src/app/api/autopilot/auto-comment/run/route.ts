import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api-auth";
import { TOO_MANY, autopilotError } from "@/lib/autopilot-api";
import { runAccountNow } from "@/lib/auto-comment-service";
import { withCtx } from "@/lib/request-ctx";
import { throttle } from "@/lib/throttle";

/** <= 2 pencarian + <= 3 draf AI + kirim. */
export const maxDuration = 120;

/**
 * Batas "Jalankan sekarang" per 10 menit. Bisa diatur lewat env; 0 = tanpa batas (hanya untuk pengujian).
 * Jeda antar-komentar, batas harian, dan cooldown penulis tetap berlaku di mesin walau batas ini dimatikan.
 */
const limitEnv = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const RUN_LIMIT_USER = limitEnv("AUTO_COMMENT_RUN_LIMIT_USER", 6);
const RUN_LIMIT_ACCOUNT = limitEnv("AUTO_COMMENT_RUN_LIMIT_ACCOUNT", 3);

/**
 * "Jalankan sekarang" untuk satu akun (Editor+). Body: `{ accountId }`. Semua batas tetap berlaku (saklar,
 * batas harian, jeda, cooldown penulis); mode Tinjau menghasilkan draf, mode Otomatis mengirim.
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const body = (await readJson(request)) as { accountId?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId : "";
  if (!accountId) return jsonError(400, "Pilih akun Threads dulu.");
  if (RUN_LIMIT_USER > 0) {
    const perUser = throttle(`acmt-run:${ctx.userId}`, RUN_LIMIT_USER, 10 * 60_000);
    if (!perUser.ok) return TOO_MANY(perUser.retryAfter);
  }
  if (RUN_LIMIT_ACCOUNT > 0) {
    const perAccount = throttle(`acmt-run-acc:${accountId}`, RUN_LIMIT_ACCOUNT, 10 * 60_000);
    if (!perAccount.ok) return TOO_MANY(perAccount.retryAfter);
  }
  try {
    const res = await runAccountNow(ctx, accountId);
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, note: res.result.note, outcome: res.result.outcome });
  } catch (err) {
    return autopilotError("autopilot/auto-comment/run:POST", err);
  }
});
