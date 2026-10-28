/**
 * Auto Komentar untuk dashboard: ringkasan, riwayat, pengaturan, tinjau draf, dan "Jalankan sekarang".
 * Semua akun disaring ke lingkup pengguna (workspace + pembatasan akun); peran ditegakkan di sini, bukan di UI.
 */
import {
  ACCOUNT_GAP_MIN,
  CLAIM_REASON_TEXT,
  DAILY_CAP_DEFAULT,
  DEFAULT_CONFIG,
  ROLE_REVIEW,
  ROLE_RUN_NOW,
  ROLE_WORKSPACE_CONFIG,
  loadAccounts,
  missingAutoCommentSchema,
  parseAccountSettings,
  parseWorkspaceConfig,
  roleAtLeast,
  roleForAccountChange,
  runDays,
  runNow,
  sendApproved,
  validateComment,
  type AutoCommentConfig,
  type AutoCommentMode,
  type ClaimReason,
  type LoadedAccount,
  type RunResult,
  type TargetStatus,
} from "./auto-comment";
import { visibleAccounts } from "./autopilot-service";
import { isPublishEnabled } from "./content-config";
import { expiredTenants } from "./plan";
import { platformFlags } from "./platform";
import { resolveWorkspace } from "./radar-service";
import type { RequestCtx, Role } from "./request-ctx";
import { startOfWibDay } from "./scheduling";
import { rpc, sqlTs } from "./supabase";

type Failure = { ok: false; status: number; error: string };

export interface AutoCommentAccountDTO {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Pengaturan tersimpan; null = belum pernah diatur (mode Mati). */
  mode: AutoCommentMode;
  slots: string[];
  keywords: string[];
  dailyCap: number;
  usedToday: number;
  lastRunAt: string | null;
  lastNote: string | null;
  doneSlots: string[];
}

export interface AutoCommentItemDTO {
  id: string;
  accountId: string;
  mediaId: string;
  authorUsername: string;
  excerpt: string;
  permalink: string | null;
  postedAt: string | null;
  keyword: string | null;
  slot: string | null;
  status?: TargetStatus;
  reason?: string | null;
  replyText: string | null;
  replyId?: string | null;
  replyPermalink?: string | null;
  sentAt?: string | null;
  createdAt: string;
}

export interface AutoCommentOverview {
  success: true;
  installed: boolean;
  role: Role;
  /** Saklar darurat super admin, saklar posting, atau paket habis: tidak ada yang berjalan. */
  blockedReason: string | null;
  config: AutoCommentConfig;
  accounts: AutoCommentAccountDTO[];
  queue: AutoCommentItemDTO[];
  counts: { terkirim7: number; draf: number; dilewati7: number; gagal7: number };
}

const EMPTY_COUNTS = { terkirim7: 0, draf: 0, dilewati7: 0, gagal7: 0 };

const FEATURE_MISSING = "Fitur ini belum siap: tabel belum dibuat di database (sql/043_auto_comment.sql). Hubungi pemilik dashboard.";

async function scope(ctx: RequestCtx) {
  const workspaceId = await resolveWorkspace(ctx);
  const accounts = (await visibleAccounts(ctx)).filter((a) => !workspaceId || a.tenantId === workspaceId);
  return { workspaceId, accounts };
}

/** Kenapa Auto Komentar tidak bisa berjalan untuk workspace ini sekarang (null = bisa). */
async function blockedReason(workspaceId: string | null, now: Date): Promise<string | null> {
  const [flags, expired] = await Promise.all([platformFlags(), expiredTenants(now)]);
  if (!flags.autopilotGlobal) return "Autopilot dan Auto Komentar sedang dihentikan sementara oleh admin platform.";
  if (!isPublishEnabled()) return "Saklar posting dashboard sedang mati.";
  if (workspaceId && expired.has(workspaceId)) return "Paket workspace sudah habis.";
  return null;
}

export async function autoCommentOverview(ctx: RequestCtx, now = new Date()): Promise<AutoCommentOverview> {
  const { workspaceId, accounts } = await scope(ctx);
  const base = (a: (typeof accounts)[number], s?: LoadedAccount): AutoCommentAccountDTO => ({
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    avatarUrl: a.avatarUrl,
    mode: s?.mode ?? "MATI",
    slots: s?.slots ?? [],
    keywords: s?.keywords ?? [],
    dailyCap: s?.dailyCap ?? DAILY_CAP_DEFAULT,
    usedToday: s?.used ?? 0,
    lastRunAt: s?.lastRunAt ?? null,
    lastNote: s?.lastNote ?? null,
    doneSlots: s?.doneSlots ?? [],
  });
  const blocked = await blockedReason(workspaceId, now);
  const empty: AutoCommentOverview = {
    success: true,
    installed: true,
    role: ctx.role,
    blockedReason: blocked,
    config: DEFAULT_CONFIG,
    accounts: accounts.map((a) => base(a)),
    queue: [],
    counts: EMPTY_COUNTS,
  };
  if (!workspaceId || accounts.length === 0) return empty;
  try {
    const raw = await rpc<{
      config: (AutoCommentConfig & { updatedAt?: string }) | null;
      accounts: LoadedAccount[];
      queue: AutoCommentItemDTO[];
      counts: AutoCommentOverview["counts"] | null;
    }>("dash_acmt_overview", {
      p_workspace: workspaceId,
      p_account_ids: accounts.map((a) => a.id),
      p_days: runDays(now),
      p_day_start: sqlTs(startOfWibDay(now)),
      p_now: sqlTs(now),
      p_queue_limit: 50,
    });
    const settings = new Map(raw.accounts.map((s) => [s.accountId, s]));
    const cfg = raw.config;
    return {
      ...empty,
      config: cfg
        ? { aktif: cfg.aktif, gapMinutes: cfg.gapMinutes, cooldownDays: cfg.cooldownDays, maxPostAgeHours: cfg.maxPostAgeHours, blockList: cfg.blockList }
        : DEFAULT_CONFIG,
      accounts: accounts.map((a) => base(a, settings.get(a.id))),
      queue: raw.queue ?? [],
      counts: raw.counts ?? EMPTY_COUNTS,
    };
  } catch (err) {
    if (missingAutoCommentSchema(err)) return { ...empty, installed: false };
    throw err;
  }
}


const HISTORY_STATUSES: TargetStatus[] = ["DILEWATI", "DRAF", "DITOLAK", "MENGIRIM", "TERKIRIM", "GAGAL"];

export async function autoCommentHistory(
  ctx: RequestCtx,
  q: { status?: string | null; beforeAt?: string | null; beforeId?: string | null; accountId?: string | null }
): Promise<{ success: true; items: AutoCommentItemDTO[]; next: { at: string; id: string } | null } | Failure> {
  const { workspaceId, accounts } = await scope(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  const status = q.status && (HISTORY_STATUSES as string[]).includes(q.status) ? q.status : null;
  const ids = q.accountId ? accounts.filter((a) => a.id === q.accountId).map((a) => a.id) : accounts.map((a) => a.id);
  const cursorOk = !!q.beforeAt && !!q.beforeId && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(q.beforeAt) && /^[\w-]{1,64}$/.test(q.beforeId);
  const LIMIT = 30;
  if (!ids.length) return { success: true, items: [], next: null };
  const items = await rpc<AutoCommentItemDTO[]>("dash_acmt_history", {
    p_workspace: workspaceId,
    p_account_ids: ids,
    p_status: status,
    p_before_at: cursorOk ? q.beforeAt!.replace("Z", "") : null,
    p_before_id: cursorOk ? q.beforeId : null,
    p_limit: LIMIT,
  });
  const last = items.at(-1);
  return { success: true, items, next: items.length === LIMIT && last ? { at: last.createdAt, id: last.id } : null };
}

/* ------------------------------------------------------------------ pengaturan */

export async function saveWorkspaceConfig(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true; config: AutoCommentConfig } | Failure> {
  if (!roleAtLeast(ctx.role, ROLE_WORKSPACE_CONFIG)) return { ok: false, status: 403, error: "Hanya Admin atau Pemilik yang bisa mengubah aturan Auto Komentar." };
  const parsed = parseWorkspaceConfig(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { workspaceId } = await scope(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  try {
    await rpc("dash_acmt_config_set", { p_workspace: workspaceId, p_cfg: parsed.value, p_user: ctx.userId, p_now: sqlTs(now) });
  } catch (err) {
    if (missingAutoCommentSchema(err)) return { ok: false, status: 503, error: FEATURE_MISSING };
    throw err;
  }
  return { ok: true, config: parsed.value };
}

export async function saveAccountSettings(
  ctx: RequestCtx,
  accountId: unknown,
  body: unknown,
  now = new Date()
): Promise<{ ok: true } | Failure> {
  if (typeof accountId !== "string") return { ok: false, status: 400, error: "Permintaan tidak valid." };
  const parsed = parseAccountSettings(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { workspaceId, accounts } = await scope(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  if (!accounts.some((a) => a.id === accountId)) return { ok: false, status: 404, error: "Akun Threads tidak ditemukan." };
  try {
    const [current] = await loadAccounts([accountId], now);
    const min = roleForAccountChange(current?.mode ?? "MATI", parsed.value.mode);
    if (!roleAtLeast(ctx.role, min)) {
      return { ok: false, status: 403, error: "Hanya Admin atau Pemilik yang bisa menyalakan atau mengubah mode Otomatis." };
    }
    await rpc("dash_acmt_setting_set", { p_account: accountId, p_workspace: workspaceId, p_set: parsed.value, p_user: ctx.userId, p_now: sqlTs(now) });
  } catch (err) {
    if (missingAutoCommentSchema(err)) return { ok: false, status: 503, error: FEATURE_MISSING };
    throw err;
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ tinjau */

export async function reviewDraft(
  ctx: RequestCtx,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; status: TargetStatus } | Failure> {
  if (!roleAtLeast(ctx.role, ROLE_REVIEW)) return { ok: false, status: 403, error: "Anda tidak punya izin untuk tindakan ini." };
  const b = (body ?? {}) as { id?: unknown; action?: unknown; text?: unknown };
  if (typeof b.id !== "string" || !/^[\w-]{1,64}$/.test(b.id) || (b.action !== "approve" && b.action !== "reject")) {
    return { ok: false, status: 400, error: "Permintaan tidak valid." };
  }
  const { workspaceId, accounts } = await scope(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  const ids = accounts.map((a) => a.id);
  try {
    if (b.action === "reject") {
      const ok = await rpc<boolean>("dash_acmt_reject", { p_id: b.id, p_account_ids: ids, p_user: ctx.userId, p_now: sqlTs(now) });
      return ok ? { ok: true, status: "DITOLAK" } : { ok: false, status: 409, error: CLAIM_REASON_TEXT.BUKAN_DRAF };
    }
    const check = validateComment(b.text);
    if (!check.ok) return { ok: false, status: 400, error: check.reason };
    const blocked = await blockedReason(workspaceId, now);
    if (blocked) return { ok: false, status: 409, error: blocked };
    const claim = await rpc<{ ok: boolean; reason?: ClaimReason; id?: string; accountId?: string; workspaceId?: string; mediaId?: string; replyText?: string }>(
      "dash_acmt_approve",
      {
        p_id: b.id,
        p_account_ids: ids,
        p_text: check.text,
        p_user: ctx.userId,
        p_day_start: sqlTs(startOfWibDay(now)),
        p_account_gap: ACCOUNT_GAP_MIN,
        p_now: sqlTs(now),
      }
    );
    if (!claim.ok || !claim.id || !claim.accountId || !claim.mediaId) {
      return { ok: false, status: 409, error: CLAIM_REASON_TEXT[claim.reason ?? "TIDAK_VALID"] };
    }
    const sent = await sendApproved({ id: claim.id, accountId: claim.accountId, mediaId: claim.mediaId, replyText: check.text }, now);
    return sent === "TERKIRIM" ? { ok: true, status: "TERKIRIM" } : { ok: false, status: 502, error: "Komentar gagal dikirim ke Threads. Lihat riwayat." };
  } catch (err) {
    if (missingAutoCommentSchema(err)) return { ok: false, status: 503, error: FEATURE_MISSING };
    throw err;
  }
}

/* ------------------------------------------------------------------ jalankan sekarang */

export async function runAccountNow(ctx: RequestCtx, accountId: unknown, now = new Date()): Promise<{ ok: true; result: RunResult } | Failure> {
  if (!roleAtLeast(ctx.role, ROLE_RUN_NOW)) return { ok: false, status: 403, error: "Anda tidak punya izin untuk tindakan ini." };
  if (typeof accountId !== "string") return { ok: false, status: 400, error: "Permintaan tidak valid." };
  const { workspaceId, accounts } = await scope(ctx);
  if (!workspaceId) return { ok: false, status: 409, error: "Workspace tidak ditemukan." };
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return { ok: false, status: 404, error: "Akun Threads tidak ditemukan." };
  if (account.reason === "NEEDS_RECONNECT" || account.reason === "TOKEN_EXPIRED") return { ok: false, status: 409, error: "Akun perlu dihubungkan ulang." };
  if (account.reason === "DI_LUAR_KUOTA") return { ok: false, status: 409, error: "Akun melebihi kuota akun paket." };
  const blocked = await blockedReason(workspaceId, now);
  if (blocked) return { ok: false, status: 409, error: blocked };
  try {
    return await runNow(accountId, workspaceId, now);
  } catch (err) {
    if (missingAutoCommentSchema(err)) return { ok: false, status: 503, error: FEATURE_MISSING };
    throw err;
  }
}

