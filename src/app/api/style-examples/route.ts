import { NextResponse } from "next/server";
import { internalError, jsonError, readJson } from "@/lib/api-auth";
import { ID_PATTERN, TOO_MANY } from "@/lib/autopilot-api";
import { canAccessAccount, withCtx, type RequestCtx } from "@/lib/request-ctx";
import {
  addStyleExample,
  deleteStyleExample,
  isMissingStyleSchema,
  layoutProfile,
  listStyleExamples,
} from "@/lib/style-corpus";
import { STYLE_NOTE_MAX, STYLE_TEXT_MAX, STYLE_TEXT_MIN } from "@/lib/style-client";
import { POST_FORMATS, detectFormat, type PostFormat } from "@/lib/style-types";
import { accountScope, db, must, tenantIdOf } from "@/lib/supabase";
import { throttle } from "@/lib/throttle";

const NO_STORE = { "Cache-Control": "no-store" };

const NOT_READY = () =>
  jsonError(503, "Fitur contoh gaya belum siap: tabel belum dibuat di database (sql/041_style_corpus.sql). Hubungi pemilik dashboard.");

/** Id akun bila terlihat oleh pengguna (lingkup tenant + akun, tanpa akun yang dikecualikan). */
async function visibleAccount(id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
  return (await accountScope()).visibleIds.includes(id) ? id : null;
}

/**
 * Workspace (tenant) tempat contoh disimpan: tenant aktif pengguna. Sebelum skema multi-user dipasang
 * (workspaceId null) diambil dari tenant akun yang dipilih.
 */
async function workspaceOf(ctx: RequestCtx, accountId: string | null): Promise<string | null> {
  if (ctx.workspaceId) return ctx.workspaceId;
  if (!accountId) return null;
  const row = await must<{ workspaceId: string | null } | null>(
    db().from("ThreadsAccount").select("workspaceId").eq("id", accountId).maybeSingle()
  );
  return tenantIdOf(row?.workspaceId ?? null);
}

const codeOf = (err: unknown): string | null => /\(([0-9A-Z]{5})\)\s*$/.exec(err instanceof Error ? err.message : "")?.[1] ?? null;

/**
 * Contoh gaya manual. `?accountId=` = contoh akun itu + yang berlaku untuk semua akun; tanpa accountId =
 * semua contoh workspace yang boleh dilihat pengguna. `&profile=1` (dengan accountId) menambah ringkasan
 * "Gaya yang terbukti" (layoutProfile, null bila postingan belum cukup).
 */
export const GET = withCtx("VIEWER", async (request, ctx) => {
  try {
    const params = request.nextUrl.searchParams;
    const rawAccount = params.get("accountId");
    const accountId = rawAccount ? await visibleAccount(rawAccount) : null;
    if (rawAccount && !accountId) return jsonError(404, "Akun Threads tidak ditemukan.");
    const workspaceId = await workspaceOf(ctx, accountId);
    if (!workspaceId) return jsonError(400, "Pilih akun Threads dulu.");

    const visible = accountId ? null : new Set((await accountScope()).visibleIds);
    const wantProfile = params.get("profile") === "1" && !!accountId;
    const [examples, profile] = await Promise.all([
      listStyleExamples(workspaceId, accountId),
      wantProfile ? layoutProfile(workspaceId, accountId!) : Promise.resolve(null),
    ]);
    // Contoh khusus akun di luar lingkup pengguna tidak ditampilkan (yang untuk semua akun tetap tampil).
    const items = examples.filter((e) => !e.accountId || (canAccessAccount(ctx, e.accountId) && (!visible || visible.has(e.accountId))));
    return NextResponse.json({ success: true, ready: true, examples: items, profile }, { headers: NO_STORE });
  } catch (err) {
    if (isMissingStyleSchema(err)) {
      return NextResponse.json({ success: true, ready: false, examples: [], profile: null }, { headers: NO_STORE });
    }
    return internalError("style-examples:GET", err);
  }
});

/**
 * Tambah contoh gaya. Body: { accountId: string | null, text, format?: PostFormat | "AUTO", note? }.
 * accountId null = berlaku untuk semua akun workspace (hanya pengguna dengan lingkup semua akun).
 */
export const POST = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`style-examples:${ctx.userId}`, 30, 5 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    const body = (await readJson(request)) as Record<string, unknown> | null;
    if (!body) return jsonError(400, "Data tidak valid.");

    const text = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "") : "";
    const len = [...text.trim()].length;
    if (len < STYLE_TEXT_MIN || [...text].length > STYLE_TEXT_MAX) {
      return jsonError(400, `Contoh gaya harus ${STYLE_TEXT_MIN}-${STYLE_TEXT_MAX} karakter.`);
    }
    let format: PostFormat;
    if (body.format === undefined || body.format === null || body.format === "AUTO") format = detectFormat(text);
    else if (typeof body.format === "string" && (POST_FORMATS as readonly string[]).includes(body.format)) format = body.format as PostFormat;
    else return jsonError(400, "Format tidak dikenal.");
    if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return jsonError(400, "Catatan tidak valid.");
    const note = typeof body.note === "string" ? body.note.trim().slice(0, STYLE_NOTE_MAX) || null : null;

    let accountId: string | null = null;
    if (body.accountId !== undefined && body.accountId !== null) {
      accountId = await visibleAccount(body.accountId);
      if (!accountId) return jsonError(404, "Akun Threads tidak ditemukan.");
    } else if (ctx.accountIds !== null) {
      return jsonError(403, "Anda hanya bisa menambah contoh untuk akun yang Anda kelola.");
    }
    const workspaceId = await workspaceOf(ctx, accountId);
    if (!workspaceId) return jsonError(400, "Pilih akun Threads dulu.");

    const example = await addStyleExample({ workspaceId, accountId, text, format, note, userId: ctx.userId });
    return NextResponse.json({ success: true, example }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isMissingStyleSchema(err)) return NOT_READY();
    const code = codeOf(err);
    if (code === "22023") return jsonError(400, "Contoh gaya tidak valid untuk workspace ini.");
    if (code === "54000") return jsonError(409, "Contoh gaya sudah 200. Hapus sebagian dulu.");
    return internalError("style-examples:POST", err);
  }
});

/** Hapus satu contoh gaya. `?id=` atau body { id }. */
export const DELETE = withCtx("EDITOR", async (request, ctx) => {
  const limit = throttle(`style-examples:${ctx.userId}`, 30, 5 * 60_000);
  if (!limit.ok) return TOO_MANY(limit.retryAfter);
  try {
    let id: unknown = request.nextUrl.searchParams.get("id");
    if (!id) id = ((await readJson(request)) as Record<string, unknown> | null)?.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return jsonError(400, "Id contoh tidak valid.");
    const workspaceId = ctx.workspaceId;
    if (!workspaceId) return jsonError(404, "Contoh gaya tidak ditemukan.");
    const ok = await deleteStyleExample(workspaceId, id, ctx.accountIds);
    return ok ? NextResponse.json({ success: true }, { headers: NO_STORE }) : jsonError(404, "Contoh gaya tidak ditemukan.");
  } catch (err) {
    if (isMissingStyleSchema(err)) return NOT_READY();
    return internalError("style-examples:DELETE", err);
  }
});
