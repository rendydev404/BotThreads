/**
 * Balas komentar otomatis untuk dashboard: daftar komentar terbaru + saklar per akun (sql/023_threads_replies.sql).
 * Semua akun disaring ke akun yang boleh dilihat pengguna (lingkup workspace + pembatasan akun).
 */
import { visibleAccounts } from "./autopilot-service";
import { MissingAutopilotSchemaError } from "./autopilot-store";
import { resolveWorkspace } from "./radar-service";
import type { RequestCtx } from "./request-ctx";
import { rpc, sqlTs } from "./supabase";
import type { Failure } from "./threads-publish";
import { ThreadsApiError, accessTokenFor, markReconnect, threads, type AccountRow } from "./threads-publisher";
import { charLength, THREADS_MAX_TEXT } from "./threads-text";

export type CommentStatus = "BARU" | "MENULIS" | "DIBALAS" | "DILEWATI" | "GAGAL";

export interface CommentDTO {
  id: string;
  accountId: string;
  username: string | null;
  text: string;
  commentedAt: string;
  status: CommentStatus;
  replyText: string | null;
  error: string | null;
  repliedAt: string | null;
  createdAt: string;
  /** 0 = komentar langsung ke postingan; >0 = membalas balasan AI (sql/025, belum terpasang = tidak ada). */
  depth?: number;
  /** Komentar yang balasan AI-nya dibalas komentar ini (sql/025). */
  parentId?: string | null;
  /** Disembunyikan dari postingan lewat manage_reply (sql/046). */
  hidden?: boolean;
  /** Balasan ditulis manual dari dashboard, bukan AI (sql/046). */
  manualReply?: boolean;
  releaseUrl: string | null;
}

export interface RepliesResponse {
  success: true;
  /** Tabel balas komentar sudah dibuat (sql/023). */
  installed: boolean;
  accounts: { id: string; username: string | null; displayName: string; avatarUrl: string | null; aktif: boolean }[];
  counts: { dibalas7: number; menunggu: number; dilewati7: number; gagal7: number };
  items: CommentDTO[];
}

const EMPTY_COUNTS = { dibalas7: 0, menunggu: 0, dilewati7: 0, gagal7: 0 };

const missing = (err: unknown) =>
  err instanceof MissingAutopilotSchemaError || /dash_reply_|PGRST202|42883/.test(err instanceof Error ? err.message : "");

export async function repliesPage(ctx: RequestCtx, now = new Date()): Promise<RepliesResponse> {
  const workspaceId = await resolveWorkspace(ctx);
  const accounts = (await visibleAccounts(ctx)).filter((a) => !workspaceId || a.tenantId === workspaceId);
  const base = accounts.map((a) => ({ id: a.id, username: a.username, displayName: a.displayName, avatarUrl: a.avatarUrl, aktif: false }));
  if (accounts.length === 0) return { success: true, installed: true, accounts: base, counts: EMPTY_COUNTS, items: [] };
  try {
    const raw = await rpc<{ settings: Record<string, boolean>; counts: RepliesResponse["counts"] | null; items: CommentDTO[] }>(
      "dash_reply_overview",
      { p_account_ids: accounts.map((a) => a.id), p_limit: 60, p_now: sqlTs(now) }
    );
    return {
      success: true,
      installed: true,
      accounts: base.map((a) => ({ ...a, aktif: raw.settings[a.id] === true })),
      counts: raw.counts ?? EMPTY_COUNTS,
      items: raw.items ?? [],
    };
  } catch (err) {
    if (missing(err)) return { success: true, installed: false, accounts: base, counts: EMPTY_COUNTS, items: [] };
    throw err;
  }
}

export async function setReplyActive(ctx: RequestCtx, accountId: unknown, aktif: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (typeof accountId !== "string" || typeof aktif !== "boolean") return { ok: false, status: 400, error: "Permintaan tidak valid." };
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  const account = (await visibleAccounts(ctx)).find((a) => a.id === accountId && a.tenantId === workspaceId);
  if (!account) return { ok: false, status: 404, error: "Akun Threads tidak ditemukan." };
  await rpc("dash_reply_setting_set", { p_workspace: workspaceId, p_account: accountId, p_aktif: aktif, p_user: ctx.userId, p_now: sqlTs(now) });
  return { ok: true };
}

/* ------------------------------------------------------------------ moderasi (threads_manage_replies, sql/046) */

interface ReplyTarget {
  id: string;
  commentId: string;
  status: CommentStatus;
  hidden: boolean;
  account: AccountRow;
  prevStatus?: Exclude<CommentStatus, "MENULIS">;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scopeIds(ctx: RequestCtx): Promise<string[]> {
  const workspaceId = await resolveWorkspace(ctx);
  return (await visibleAccounts(ctx)).filter((a) => !workspaceId || a.tenantId === workspaceId).map((a) => a.id);
}

function apiFailure(err: unknown, accountId: string, now: Date): Failure {
  if (err instanceof ThreadsApiError) {
    if (err.isAuthError) {
      void markReconnect(accountId, now);
      return { ok: false, status: 409, error: "Sesi Threads tidak berlaku lagi. Hubungkan ulang akun Threads." };
    }
    return { ok: false, status: 502, error: err.message };
  }
  throw err;
}

/** Sembunyikan / tampilkan lagi komentar di postingan (Threads API manage_reply), lalu simpan statusnya. */
export async function setCommentHidden(ctx: RequestCtx, id: unknown, hidden: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (typeof id !== "string" || typeof hidden !== "boolean") return { ok: false, status: 400, error: "Permintaan tidak valid." };
  const ids = await scopeIds(ctx);
  if (ids.length === 0) return { ok: false, status: 404, error: "Komentar tidak ditemukan." };
  const target = await rpc<ReplyTarget | null>("dash_reply_target", { p_id: id, p_account_ids: ids });
  if (!target) return { ok: false, status: 404, error: "Komentar tidak ditemukan." };
  const token = await accessTokenFor(target.account, now);
  if (!token) return { ok: false, status: 409, error: "Sesi Threads kedaluwarsa. Hubungkan ulang akun Threads." };
  try {
    await threads.manageReply(target.commentId, token, hidden);
  } catch (err) {
    return apiFailure(err, target.account.id, now);
  }
  await rpc<boolean>("dash_reply_hide_set", { p_id: id, p_hidden: hidden, p_now: sqlTs(now) });
  return { ok: true };
}

/** Balas satu komentar dengan teks yang ditulis pengguna (reply_to_id = komentar itu). */
export async function sendManualReply(ctx: RequestCtx, id: unknown, text: unknown, now = new Date()): Promise<{ ok: true; replyId: string } | Failure> {
  if (typeof id !== "string" || typeof text !== "string") return { ok: false, status: 400, error: "Permintaan tidak valid." };
  const body = text.trim();
  if (!body) return { ok: false, status: 400, error: "Teks balasan kosong." };
  if (charLength(body) > THREADS_MAX_TEXT) return { ok: false, status: 400, error: `Threads maksimal ${THREADS_MAX_TEXT} karakter.` };
  const ids = await scopeIds(ctx);
  if (ids.length === 0) return { ok: false, status: 404, error: "Komentar tidak ditemukan." };
  const target = await rpc<ReplyTarget | null>("dash_reply_manual_lock", { p_id: id, p_account_ids: ids, p_now: sqlTs(now) });
  if (!target) return { ok: false, status: 409, error: "Komentar sedang dibalas AI atau tidak ditemukan. Coba lagi sebentar." };
  const close = (ok: boolean, patch: { replyId?: string; error?: string }) =>
    rpc<boolean>("dash_reply_manual_done", {
      p_id: id,
      p_ok: ok,
      p_prev: target.prevStatus ?? "BARU",
      p_reply_text: ok ? body : null,
      p_reply_id: patch.replyId ?? null,
      p_error: patch.error ?? null,
      p_now: sqlTs(new Date()),
    });
  try {
    const token = await accessTokenFor(target.account, now);
    if (!token) {
      await close(false, { error: "Sesi Threads kedaluwarsa. Hubungkan ulang akun Threads." });
      return { ok: false, status: 409, error: "Sesi Threads kedaluwarsa. Hubungkan ulang akun Threads." };
    }
    const userId = target.account.threadsUserId;
    const containerId = await threads.createText(userId, token, body, { reply_to_id: target.commentId });
    for (let i = 0; i < 4; i++) {
      const { status, error_message } = await threads.status(containerId, token);
      if (status === "FINISHED") break;
      if (status === "ERROR" || status === "EXPIRED") throw new ThreadsApiError(error_message || `Balasan ditolak Threads (${status}).`, 400, -1);
      await sleep(1500);
    }
    const replyId = await threads.publish(userId, token, containerId);
    await close(true, { replyId });
    return { ok: true, replyId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal mengirim balasan.";
    await close(false, { error: message }).catch(() => undefined);
    return apiFailure(err, target.account.id, now);
  }
}
