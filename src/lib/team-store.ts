/**
 * Akses data multi-user: pembungkus bertipe untuk fungsi RPC `dash_mu_*` (sql/008_multiuser.sql):
 * anggota, undangan, reset password, pengaturan workspace, dan audit. Tanpa logika bisnis.
 */
import { MissingAutopilotSchemaError, isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import type { RequestCtx, Role } from "./request-ctx";
import { rpc, utc } from "./supabase";

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

const iso = (v: string | null): string | null => (v ? utc(v).toISOString() : null);

/* ------------------------------------------------------------------ audit */

/**
 * Catat satu tindakan pengguna ke audit. Tidak pernah menggagalkan tindakan utamanya: bila skema
 * belum dipasang atau pencatatan gagal, galatnya hanya masuk log server.
 */
export async function audit(ctx: RequestCtx, action: string, target: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  if (!ctx.workspaceId) return;
  try {
    await call<boolean>("dash_mu_audit_add", {
      p_workspace: ctx.workspaceId,
      p_actor: ctx.userId,
      p_action: action,
      p_target: target,
      p_detail: detail,
      p_now: new Date(),
    });
  } catch (err) {
    if (!(err instanceof MissingAutopilotSchemaError)) {
      console.error("[audit]", err instanceof Error ? err.message : "galat tak dikenal");
    }
  }
}

export interface AuditRow {
  id: string;
  actor: string;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export async function listAudit(workspaceId: string, cursor: { at: Date; id: string } | null, limit: number): Promise<AuditRow[]> {
  const rows = await call<AuditRow[]>("dash_mu_audit", {
    p_workspace: workspaceId,
    p_cursor_at: cursor?.at ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: limit,
  });
  return rows.map((r) => ({ ...r, createdAt: utc(r.createdAt).toISOString() }));
}

/* ------------------------------------------------------------------ anggota */

export interface MemberRow {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  google: boolean;
  role: Role;
  accountScope: "SEMUA" | "PILIHAN";
  accountIds: string[];
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  const rows = await call<MemberRow[]>("dash_mu_members", { p_workspace: workspaceId });
  return rows.map((r) => ({ ...r, lastLoginAt: iso(r.lastLoginAt) }));
}

export type MemberResult = "OK" | "NOT_FOUND" | "LAST_OWNER" | "FORBIDDEN";

/** Ubah peran dan lingkup akun anggota (`accountIds` null = semua akun). */
export const setMember = (workspaceId: string, targetId: string, role: Role, accountIds: string[] | null, actorId: string, now: Date) =>
  call<MemberResult>("dash_mu_member_set", {
    p_workspace: workspaceId,
    p_target: targetId,
    p_role: role,
    p_account_ids: accountIds,
    p_actor: actorId,
    p_now: now,
  });

export const removeMember = (workspaceId: string, targetId: string, actorId: string, now: Date) =>
  call<MemberResult>("dash_mu_member_remove", { p_workspace: workspaceId, p_target: targetId, p_actor: actorId, p_now: now });

export const setActiveWorkspace = (userId: string, workspaceId: string) =>
  call<boolean>("dash_mu_set_workspace", { p_user: userId, p_workspace: workspaceId });

/* ------------------------------------------------------------------ undangan */

export interface InviteRow {
  id: string;
  email: string;
  role: Exclude<Role, "OWNER">;
  accountIds: string[];
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

export async function listInvites(workspaceId: string, now: Date): Promise<InviteRow[]> {
  const rows = await call<InviteRow[]>("dash_mu_invites", { p_workspace: workspaceId, p_now: now });
  return rows.map((r) => ({ ...r, expiresAt: utc(r.expiresAt).toISOString(), createdAt: utc(r.createdAt).toISOString() }));
}

export const createInvite = (
  item: { workspaceId: string; email: string; role: Exclude<Role, "OWNER">; accountIds: string[]; tokenHash: string; expiresAt: string },
  actorId: string,
  now: Date
) => call<string>("dash_mu_invite_create", { p_item: item, p_actor: actorId, p_now: now });

export const revokeInvite = (id: string, workspaceId: string, actorId: string, now: Date) =>
  call<boolean>("dash_mu_invite_revoke", { p_id: id, p_workspace: workspaceId, p_actor: actorId, p_now: now });

export interface InvitePeek {
  email: string;
  role: Exclude<Role, "OWNER">;
  workspace: string;
  /** Email sudah punya akun dashboard: cukup konfirmasi, tanpa membuat password baru. */
  hasAccount: boolean;
}

export const peekInvite = (tokenHash: string, now: Date) =>
  call<InvitePeek | null>("dash_mu_invite_peek", { p_token_hash: tokenHash, p_now: now });

/** Terima undangan (sekali pakai). Mengembalikan pengguna untuk dibuatkan sesi, atau null bila tidak sah. */
export const acceptInvite = (
  tokenHash: string,
  user: { username: string; name: string | null; passwordHash: string } | null,
  googleSub: string | null,
  now: Date
) =>
  call<{ userId: string; passwordHash: string } | null>("dash_mu_invite_accept", {
    p_token_hash: tokenHash,
    p_user: user ?? {},
    p_google_sub: googleSub,
    p_now: now,
  });

/* ------------------------------------------------------------------ pendaftaran mandiri */

export type SignupResult = { status: "OK"; userId: string; passwordHash: string; workspaceId: string } | { status: "EMAIL" | "USERNAME" };

/** Buat pengguna, workspace (tenant) baru, dan keanggotaan Pemilik sekaligus (sql/009_signup.sql). */
export const signup = (user: { username: string; email: string; name: string | null; passwordHash: string }, brand: string, now: Date) =>
  call<SignupResult>("dash_mu_signup", { p_user: user, p_brand: brand, p_now: now });

/* ------------------------------------------------------------------ password dan Google */

export const createPasswordReset = (workspaceId: string, targetId: string, tokenHash: string, expiresAt: Date, actorId: string, now: Date) =>
  call<boolean>("dash_mu_reset_create", {
    p_workspace: workspaceId,
    p_target: targetId,
    p_token_hash: tokenHash,
    p_expires: expiresAt,
    p_actor: actorId,
    p_now: now,
  });

/** Pakai tautan reset (sekali): mengembalikan id pengguna, atau null bila tautan tidak sah/kedaluwarsa. */
export const consumePasswordReset = (tokenHash: string, passwordHash: string, now: Date) =>
  call<string | null>("dash_mu_reset_consume", { p_token_hash: tokenHash, p_password_hash: passwordHash, p_now: now });

/** Pengguna untuk login Google (cocok lewat akun Google atau email terverifikasi); null bila tidak terdaftar. */
export const findGoogleUser = (sub: string, email: string, now: Date) =>
  call<{ id: string; passwordHash: string; isActive: boolean } | null>("dash_mu_google_user", { p_sub: sub, p_email: email, p_now: now });

/* ------------------------------------------------------------------ pengaturan workspace */

export interface WorkspaceBrand {
  workspaceId: string;
  namaBrand: string | null;
  deskripsiBrand: string | null;
  topikTerlarang: string[];
}

export const getWorkspaceSettings = (workspaceId: string) =>
  call<(WorkspaceBrand & { autopilotAktif: boolean }) | null>("dash_mu_settings_get", { p_workspace: workspaceId });

export const setWorkspaceSettings = (
  workspaceId: string,
  item: { namaBrand: string | null; deskripsiBrand: string | null; topikTerlarang: string[] },
  actorId: string,
  now: Date
) => call<boolean>("dash_mu_settings_set", { p_workspace: workspaceId, p_item: item, p_actor: actorId, p_now: now });

/** Brand semua workspace (untuk tick autopilot); kosong bila skema multi-user belum dipasang. */
export async function listBrands(): Promise<Map<string, WorkspaceBrand>> {
  try {
    const rows = await call<WorkspaceBrand[]>("dash_mu_brands");
    return new Map(rows.map((b) => [b.workspaceId, b]));
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return new Map();
    throw err;
  }
}
