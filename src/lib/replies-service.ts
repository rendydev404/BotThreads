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
