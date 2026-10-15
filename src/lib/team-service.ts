/**
 * Layanan tim (multi-user): anggota dan peran, undangan, reset password, ganti password sendiri,
 * pindah workspace, pengaturan workspace, dan audit.
 *
 * Tautan undangan dan reset memuat token acak 256-bit yang hanya ditampilkan sekali; database hanya
 * menyimpan hash SHA-256-nya. Belum ada pengirim email: admin menyalin tautan dan mengirimkannya sendiri.
 */
import { createHash, randomBytes } from "node:crypto";
import { visibleAccounts } from "./autopilot-service";
import { MissingAutopilotSchemaError } from "./autopilot-store";
import { hashPassword, verifyPassword } from "./password";
import { planLimits } from "./plan";
import { platformFlags } from "./platform";
import { NO_WORKSPACE, forgetMembership, hasRole, type RequestCtx, type Role } from "./request-ctx";
import { db, must, nowTs } from "./supabase";
import {
  acceptInvite,
  consumePasswordReset,
  createInvite,
  createPasswordReset,
  getWorkspaceSettings,
  listAudit,
  listInvites,
  listMembers,
  peekInvite,
  removeMember,
  revokeInvite,
  setActiveWorkspace,
  setMember,
  setWorkspaceSettings,
  signup,
  type AuditRow,
  type InvitePeek,
  type InviteRow,
  type MemberResult,
  type MemberRow,
} from "./team-store";
import { decodeCursor, encodeCursor, type Failure } from "./threads-publish";
import { forgetUserStatus } from "./users";

const HOUR_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 72 * HOUR_MS;
export const RESET_TTL_MS = HOUR_MS;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const AUDIT_PAGE_SIZE = 25;
const ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Token acak untuk tautan (hanya ditampilkan sekali) dan hash yang disimpan. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export const isToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);

export function passwordError(password: unknown): string | null {
  if (typeof password !== "string") return "Password tidak valid.";
  if (password.length < PASSWORD_MIN) return `Password minimal ${PASSWORD_MIN} karakter.`;
  if (password.length > PASSWORD_MAX) return `Password maksimal ${PASSWORD_MAX} karakter.`;
  return null;
}

const NOT_INSTALLED = "Fitur tim belum dipasang di database (sql/008_multiuser.sql). Hubungi pemilik dashboard.";

/** Workspace aktif pengguna; fitur tim butuh skema multi-user terpasang dan keanggotaan nyata. */
function workspaceOf(ctx: RequestCtx): string | Failure {
  if (!ctx.workspaceId) return failure(503, NOT_INSTALLED);
  if (ctx.workspaceId === NO_WORKSPACE) return failure(403, "Anda belum menjadi anggota workspace mana pun.");
  return ctx.workspaceId;
}

const memberMessage = (r: Exclude<MemberResult, "OK">): Failure =>
  r === "NOT_FOUND"
    ? failure(404, "Anggota tidak ditemukan.")
    : r === "LAST_OWNER"
      ? failure(409, "Workspace harus punya minimal satu Pemilik aktif.")
      : failure(403, "Hanya Pemilik yang bisa mengatur peran Pemilik.");

/* ------------------------------------------------------------------ anggota */

export interface TeamResponse {
  success: true;
  me: { userId: string; role: Role };
  members: MemberRow[];
  invites: InviteRow[];
}

export async function getTeam(ctx: RequestCtx, now = new Date()): Promise<TeamResponse | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  try {
    const [members, invites] = await Promise.all([listMembers(ws), listInvites(ws, now)]);
    return { success: true, me: { userId: ctx.userId, role: ctx.role }, members, invites };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return failure(503, NOT_INSTALLED);
    throw err;
  }
}

/** Akun yang boleh dipilih untuk lingkup anggota: harus akun workspace ini yang terlihat oleh pengubah. */
async function parseAccountScope(ctx: RequestCtx, raw: unknown): Promise<string[] | null | Failure> {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500 || !raw.every((v) => typeof v === "string")) {
    return failure(400, "Daftar akun tidak valid. Kosongkan untuk semua akun.");
  }
  const visible = new Set((await visibleAccounts(ctx)).map((a) => a.id));
  const ids = [...new Set(raw as string[])];
  if (ids.some((id) => !visible.has(id))) return failure(404, "Akun Threads tidak ditemukan.");
  return ids;
}

export async function updateMember(ctx: RequestCtx, targetId: string, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  if (!isRecord(body) || !ROLES.includes(body.role as Role)) return failure(400, "Peran tidak valid.");
  const role = body.role as Role;
  const accountIds = await parseAccountScope(ctx, body.accountIds);
  if (accountIds !== null && !Array.isArray(accountIds)) return accountIds;

  const result = await setMember(ws, targetId, role, role === "OWNER" ? null : accountIds, ctx.userId, now);
  if (result !== "OK") return memberMessage(result);
  forgetMembership(targetId);
  return { ok: true };
}

export async function removeTeamMember(ctx: RequestCtx, targetId: string, now = new Date()): Promise<{ ok: true } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  const result = await removeMember(ws, targetId, ctx.userId, now);
  if (result !== "OK") return memberMessage(result);
  forgetMembership(targetId);
  return { ok: true };
}

/* ------------------------------------------------------------------ undangan */

/** Buat undangan dan kembalikan path tautannya (sekali tampil). */
export async function inviteMember(
  ctx: RequestCtx,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; path: string; expiresAt: string; invite: InviteRow } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return failure(400, "Alamat email tidak valid.");
  const role = body.role as Role;
  if (!["ADMIN", "EDITOR", "VIEWER"].includes(role)) return failure(400, "Peran undangan harus Admin, Editor, atau Pengamat.");
  const accountIds = await parseAccountScope(ctx, body.accountIds);
  if (accountIds !== null && !Array.isArray(accountIds)) return accountIds;

  const limits = await planLimits(ws, now, true);
  if (limits.plan && limits.pakai.anggota >= limits.plan.maxAnggota) {
    return failure(403, `Paket ${limits.plan.nama} mengizinkan ${limits.plan.maxAnggota} anggota (termasuk undangan yang belum diterima). Naikkan paket atau cabut undangan lama.`);
  }

  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  const invite = { email, role: role as Exclude<Role, "OWNER">, accountIds: accountIds ?? [], expiresAt: expiresAt.toISOString() };
  // Undangan lama untuk email yang sama digantikan (lihat dash_mu_invite_create).
  const id = await createInvite({ workspaceId: ws, ...invite, tokenHash: hash }, ctx.userId, now);
  return {
    ok: true,
    path: `/undangan/${token}`,
    expiresAt: invite.expiresAt,
    invite: { id, ...invite, createdAt: now.toISOString(), expired: false },
  };
}

export async function cancelInvite(ctx: RequestCtx, inviteId: string, now = new Date()): Promise<{ ok: true } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  return (await revokeInvite(inviteId, ws, ctx.userId, now)) ? { ok: true } : failure(404, "Undangan tidak ditemukan.");
}

const INVALID_INVITE = "Undangan tidak berlaku lagi. Minta admin mengirim undangan baru.";

/** Isi undangan untuk halaman terima undangan (publik; token adalah buktinya). */
export async function previewInvite(token: unknown, now = new Date()): Promise<{ ok: true; invite: InvitePeek } | Failure> {
  if (!isToken(token)) return failure(404, INVALID_INVITE);
  const invite = await peekInvite(hashToken(token), now);
  return invite ? { ok: true, invite } : failure(404, INVALID_INVITE);
}

export interface SessionUser {
  userId: string;
  passwordHash: string;
}

/**
 * Terima undangan dengan membuat password (pengguna baru). Email yang sudah punya akun cukup
 * mengonfirmasi (tanpa password) lalu masuk seperti biasa: sesi TIDAK dibuat di sini untuk akun lama,
 * supaya memegang tautan undangan saja tidak cukup untuk masuk sebagai orang lain.
 */
export async function acceptInviteWithPassword(
  token: unknown,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; session: SessionUser | null } | Failure> {
  if (!isToken(token)) return failure(404, INVALID_INVITE);
  const hash = hashToken(token);
  const invite = await peekInvite(hash, now);
  if (!invite) return failure(404, INVALID_INVITE);

  if (invite.hasAccount) {
    const done = await acceptInvite(hash, null, null, now);
    return done ? { ok: true, session: null } : failure(404, INVALID_INVITE);
  }

  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) return failure(400, "Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.");
  const pwError = passwordError(body.password);
  if (pwError) return failure(400, pwError);
  const name = typeof body.name === "string" ? body.name.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || null : null;

  try {
    const user = await acceptInvite(hash, { username, name, passwordHash: await hashPassword(body.password as string) }, null, now);
    return user ? { ok: true, session: user } : failure(404, INVALID_INVITE);
  } catch (err) {
    // 23505 = unique_violation (username sudah dipakai).
    if (err instanceof Error && /23505|duplicate key/i.test(err.message)) return failure(409, "Username sudah dipakai. Pilih yang lain.");
    throw err;
  }
}

/* ------------------------------------------------------------------ pendaftaran mandiri */

/** Saklar tingkat server: tanpa SIGNUP_ENABLED=true pendaftaran mandiri mati total (masuk lewat undangan saja). */
export const signupEnvEnabled = (): boolean => process.env.SIGNUP_ENABLED === "true";

/** Pendaftaran mandiri benar-benar terbuka: saklar server menyala DAN super admin tidak menutupnya. */
export async function signupOpen(): Promise<boolean> {
  return signupEnvEnabled() && (await platformFlags()).signupOpen;
}

/**
 * Daftar mandiri: akun baru + workspace baru dengan pendaftar sebagai Pemilik. Workspace itu belum
 * punya akun Threads; penghubungan akun tetap lewat SukaPost.
 */
export async function registerAccount(body: unknown, now = new Date()): Promise<{ ok: true; session: SessionUser } | Failure> {
  if (!(await signupOpen())) return failure(403, "Pendaftaran belum dibuka. Minta undangan dari pemilik workspace.");
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return failure(400, "Alamat email tidak valid.");
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) return failure(400, "Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.");
  const pwError = passwordError(body.password);
  if (pwError) return failure(400, pwError);
  const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
  const brand = clean(body.brand, 80);
  if (brand.length < 2) return failure(400, "Nama brand harus 2-80 karakter.");
  const name = clean(body.name, 80) || null;

  try {
    const made = await signup({ username, email, name, passwordHash: await hashPassword(body.password as string) }, brand, now);
    if (made.status === "EMAIL") return failure(409, "Email ini sudah terdaftar. Silakan masuk, atau minta admin mereset password Anda.");
    if (made.status !== "OK") return failure(409, "Username sudah dipakai. Pilih yang lain.");
    return { ok: true, session: { userId: made.userId, passwordHash: made.passwordHash } };
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return failure(503, "Pendaftaran belum siap di server (sql/009_signup.sql belum dipasang).");
    if (err instanceof Error && /23505|duplicate key/i.test(err.message)) return failure(409, "Username atau email sudah dipakai.");
    throw err;
  }
}

/* ------------------------------------------------------------------ password */

/** Admin membuat tautan reset password untuk anggota workspace-nya (berlaku 60 menit, sekali pakai). */
export async function createResetLink(ctx: RequestCtx, targetId: string, now = new Date()): Promise<{ ok: true; path: string; expiresAt: string } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  const { token, hash } = newToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  const made = await createPasswordReset(ws, targetId, hash, expiresAt, ctx.userId, now);
  return made ? { ok: true, path: `/reset-password/${token}`, expiresAt: expiresAt.toISOString() } : failure(404, "Anggota tidak ditemukan.");
}

const INVALID_RESET = "Tautan reset tidak berlaku lagi. Minta admin membuat tautan baru.";

/** Pakai tautan reset: pasang password baru. Sesi lama pengguna gugur dengan sendirinya. */
export async function resetPassword(token: unknown, password: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!isToken(token)) return failure(404, INVALID_RESET);
  const pwError = passwordError(password);
  if (pwError) return failure(400, pwError);
  const userId = await consumePasswordReset(hashToken(token), await hashPassword(password as string), now);
  if (!userId) return failure(404, INVALID_RESET);
  forgetUserStatus(userId);
  return { ok: true };
}

/** Ganti password sendiri (wajib menyebut password lama). Mengembalikan hash baru untuk menerbitkan sesi baru. */
export async function changeOwnPassword(ctx: RequestCtx, body: unknown): Promise<{ ok: true; session: SessionUser } | Failure> {
  if (!isRecord(body) || typeof body.current !== "string" || body.current.length > PASSWORD_MAX) {
    return failure(400, "Password saat ini wajib diisi.");
  }
  const pwError = passwordError(body.next);
  if (pwError) return failure(400, pwError);
  const user = await must<{ passwordHash: string } | null>(
    db().from("DashboardUser").select("passwordHash").eq("id", ctx.userId).maybeSingle()
  );
  if (!user || !(await verifyPassword(body.current, user.passwordHash))) return failure(403, "Password saat ini salah.");
  const passwordHash = await hashPassword(body.next as string);
  await must(db().from("DashboardUser").update({ passwordHash, updatedAt: nowTs() }).eq("id", ctx.userId).select("id"));
  forgetUserStatus(ctx.userId);
  return { ok: true, session: { userId: ctx.userId, passwordHash } };
}

/* ------------------------------------------------------------------ workspace */

export async function switchWorkspace(ctx: RequestCtx, workspaceId: unknown): Promise<{ ok: true } | Failure> {
  if (typeof workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(workspaceId)) return failure(400, "Workspace tidak valid.");
  if (!ctx.workspaces?.some((w) => w.workspaceId === workspaceId)) return failure(404, "Workspace tidak ditemukan.");
  if (!(await setActiveWorkspace(ctx.userId, workspaceId))) return failure(404, "Workspace tidak ditemukan.");
  forgetMembership(ctx.userId);
  return { ok: true };
}

export interface WorkspaceSettingsResponse {
  success: true;
  workspaceId: string;
  namaBrand: string;
  deskripsiBrand: string;
  topikTerlarang: string[];
  canEdit: boolean;
}

export async function getSettings(ctx: RequestCtx): Promise<WorkspaceSettingsResponse | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  const s = await getWorkspaceSettings(ws);
  return {
    success: true,
    workspaceId: ws,
    namaBrand: s?.namaBrand ?? "",
    deskripsiBrand: s?.deskripsiBrand ?? "",
    topikTerlarang: s?.topikTerlarang ?? [],
    canEdit: hasRole(ctx, "ADMIN"),
  };
}

export type BrandSettings = Pick<WorkspaceSettingsResponse, "namaBrand" | "deskripsiBrand" | "topikTerlarang">;

/** Simpan pengaturan brand; balasannya nilai yang tersimpan (sudah dirapikan) supaya klien tidak perlu menebak. */
export async function saveSettings(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true; settings: BrandSettings } | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const text = (v: unknown, max: number): string | null =>
    typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : null;
  const namaBrand = text(body.namaBrand, 80);
  if (!namaBrand || namaBrand.length < 2) return failure(400, "Nama brand harus 2-80 karakter.");
  if (body.deskripsiBrand !== undefined && body.deskripsiBrand !== null && typeof body.deskripsiBrand !== "string") {
    return failure(400, "Deskripsi brand tidak valid.");
  }
  const raw = body.topikTerlarang ?? [];
  if (!Array.isArray(raw) || raw.length > 100 || !raw.every((v) => typeof v === "string")) {
    return failure(400, "Daftar topik terlarang tidak valid (maksimal 100).");
  }
  const topikTerlarang = [...new Set((raw as string[]).map((t) => t.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()).filter((t) => t.length >= 3 && t.length <= 60))];
  const deskripsiBrand = text(body.deskripsiBrand, 600) || null;
  await setWorkspaceSettings(ws, { namaBrand, deskripsiBrand, topikTerlarang }, ctx.userId, now);
  return { ok: true, settings: { namaBrand, deskripsiBrand: deskripsiBrand ?? "", topikTerlarang } };
}

/* ------------------------------------------------------------------ audit */

export interface AuditResponse {
  success: true;
  items: AuditRow[];
  nextCursor: string | null;
}

export async function getAudit(ctx: RequestCtx, cursorRaw: string | null): Promise<AuditResponse | Failure> {
  const ws = workspaceOf(ctx);
  if (typeof ws !== "string") return ws;
  const rows = await listAudit(ws, decodeCursor(cursorRaw), AUDIT_PAGE_SIZE);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    success: true,
    items: page,
    nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
  };
}
