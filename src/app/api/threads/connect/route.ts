import { NextResponse } from "next/server";
import { afterResponse } from "@/lib/after-safe";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { kickOnboarding } from "@/lib/account-onboarding";
import { withCtx } from "@/lib/request-ctx";
import { connectThreadsAccount, listWorkspaceThreadsAccounts, removeThreadsAccount, syncThreadsAccount } from "@/lib/threads-connect";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

/** Agen onboarding (baca postingan, riset tren, isi ide) berjalan di `after()` dan ikut batas waktu route. */
export const maxDuration = 300;

/** Daftar akun Threads yang terhubung di workspace saat ini beserta kuota paketnya. */
export const GET = withCtx("VIEWER", async (_request, ctx) => {
  try {
    if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");
    return NextResponse.json(await listWorkspaceThreadsAccounts(ctx.workspaceId), { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/connect:GET", err);
  }
});

/** Hubungkan akun Threads dengan menempel Access Token (peran ADMIN atau OWNER). */
export const POST = withCtx("ADMIN", async (request, ctx) => {
  const limit = throttle(`threads-connect:${ctx.userId}`, 15, 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi sebentar.");
  if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");

  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken.slice(0, 1000) : "";
    const res = await connectThreadsAccount({ workspaceId: ctx.workspaceId, userId: ctx.userId, accessToken, via: "token" });
    if (!res.ok) return jsonError(res.status, res.error);
    // Agen AI langsung mempelajari akun hari ini juga: baca postingan, kenali peran, riset tren, isi ide.
    const { workspaceId, userId } = ctx;
    afterResponse("onboarding", () => kickOnboarding(res.account.id, workspaceId, userId));
    return NextResponse.json({ success: true, account: res.account }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/connect:POST", err);
  }
});

/** Sinkronkan profil akun dari Threads (nama, username, foto). Body: { accountId }. */
export const PATCH = withCtx("ADMIN", async (request, ctx) => {
  const limit = throttle(`threads-sync:${ctx.userId}`, 20, 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi sebentar.");
  if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");

  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const res = await syncThreadsAccount({ workspaceId: ctx.workspaceId, accountId: body?.accountId });
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true, account: res.account }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/connect:PATCH", err);
  }
});

/** Hapus akun Threads dari workspace; slot kuota kosong lagi. Body: { accountId }. */
export const DELETE = withCtx("ADMIN", async (request, ctx) => {
  const limit = throttle(`threads-remove:${ctx.userId}`, 10, 60_000);
  if (!limit.ok) return jsonError(429, "Terlalu banyak percobaan. Coba lagi sebentar.");
  if (!ctx.workspaceId) return jsonError(403, "Workspace tidak ditemukan.");

  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const res = await removeThreadsAccount({ workspaceId: ctx.workspaceId, userId: ctx.userId, accountId: body?.accountId });
    if (!res.ok) return jsonError(res.status, res.error);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return internalError("threads/connect:DELETE", err);
  }
});
