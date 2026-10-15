/**
 * Layanan panel super admin: validasi masukan, pemanggilan fungsi `dash_sa_*` (sql/010_superadmin.sql),
 * dan pembersihan cache supaya tindakan berlaku seketika. Pemeriksaan "pelaku adalah super admin"
 * dilakukan dua kali: di route (`withSuperAdmin`) dan di dalam setiap fungsi SQL yang mengubah data.
 */
import {
  ADMIN_ANNOUNCEMENT_MAX,
  ADMIN_PAGE_SIZE,
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
  type AdminAuditDTO,
  type AdminAuditResponse,
  type AdminFlags,
  type AdminOverviewResponse,
  type AdminSettingsResponse,
  type AdminSourceDTO,
  type AdminSourceListResponse,
  type AdminUserDTO,
  type AdminUserListResponse,
  type AdminUserStatus,
  type AdminWorkspaceDTO,
  type AdminWorkspaceListResponse,
} from "./admin-types";
import { MissingAutopilotSchemaError, isMissingAutopilotSchema } from "./autopilot-store";
import { isPublishEnabled } from "./content-config";
import { setWorkspacePlan, workspacePlans } from "./plan";
import { forgetPlatform } from "./platform";
import { forgetPublishAccounts } from "./publish-accounts";
import { forgetMembership, type Role } from "./request-ctx";
import { forgetAccountCaches, likeEscape, rpc, utc } from "./supabase";
import { newToken, signupEnvEnabled } from "./team-service";
import { decodeCursor, encodeCursor, type Failure } from "./threads-publish";
import { forgetUserStatus } from "./users";

const SQL_FILE = "sql/010_superadmin.sql";
const RESET_TTL_MS = 60 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const ROLES: Role[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];
const STATUSES: AdminUserStatus[] = ["AKTIF", "DIBLOKIR", "NONAKTIF", "SUPERADMIN", "STAF"];

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (v: string | null): string | null => (v ? utc(v).toISOString() : null);

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err) || (err instanceof Error && /PGRST202|42883|42P01|42703/.test(err.message) && /dash_sa_|Platform/.test(err.message))) {
      throw new MissingAutopilotSchemaError(SQL_FILE);
    }
    throw err;
  }
}

/** Alasan wajib untuk tindakan yang merugikan pihak lain (blokir, tangguhkan). */
function parseReason(raw: unknown): string | Failure {
  const reason = typeof raw === "string" ? raw.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (reason.length < ADMIN_REASON_MIN || reason.length > ADMIN_REASON_MAX) {
    return failure(400, `Alasan wajib diisi, ${ADMIN_REASON_MIN}-${ADMIN_REASON_MAX} karakter.`);
  }
  return reason;
}

import { computeSaaSKpis } from "./billing";
import { ASSIGNABLE_PERMS, ROLE_ID_PATTERN, type AdminRoleDTO, type AdminRolesResponse, type AdminStaffDTO } from "./admin-perms";
import { hashPassword } from "./password";
import type { AdminActor } from "./request-ctx";
import { passwordError } from "./team-service";
import { cancelPost, listPosts, retryPost, type ListResult } from "./threads-publish";
import type { PostStatusKey } from "./content-types";

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/* ------------------------------------------------------------------ ringkasan */

export async function getOverview(now = new Date()): Promise<AdminOverviewResponse> {
  const raw = await call<Omit<AdminOverviewResponse, "success" | "signupEnv" | "publishEnv" | "serverNow" | "kpi">>("dash_sa_overview", { p_now: now });
  const kpi = await computeSaaSKpis(raw, now).catch(() => undefined);
  return {
    success: true,
    ...raw,
    autopilot: { ...raw.autopilot, tickTerakhir: iso(raw.autopilot.tickTerakhir) },
    signupEnv: signupEnvEnabled(),
    publishEnv: isPublishEnabled(),
    serverNow: now.toISOString(),
    ...(kpi ? { kpi } : {}),
  };
}

/* ------------------------------------------------------------------ pengguna */

export async function listUsers(adminId: string, p: { q: string | null; status: string | null; cursor: string | null }): Promise<AdminUserListResponse | Failure> {
  if (p.status !== null && !STATUSES.includes(p.status as AdminUserStatus)) return failure(400, "Status tidak valid.");
  const q = (p.q ?? "").trim().slice(0, 80);
  const cursor = decodeCursor(p.cursor);
  const rows = await call<AdminUserDTO[]>("dash_sa_users", {
    p_q: q ? likeEscape(q) : null,
    p_status: p.status,
    p_cursor_at: cursor?.at ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_limit: ADMIN_PAGE_SIZE + 1,
  });
  const page = rows.slice(0, ADMIN_PAGE_SIZE).map((u) => ({
    ...u,
    bannedAt: iso(u.bannedAt),
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: utc(u.createdAt).toISOString(),
  }));
  const last = page.at(-1);
  return {
    success: true,
    items: page,
    nextCursor: rows.length > ADMIN_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
    me: adminId,
  };
}

const USER_ERRORS: Record<string, Failure> = {
  FORBIDDEN: failure(403, "Peran admin Anda tidak punya izin untuk tindakan ini."),
  NOT_FOUND: failure(404, "Pengguna tidak ditemukan."),
  SELF: failure(409, "Tindakan ini tidak bisa dilakukan pada akun sendiri."),
  SUPERADMIN: failure(409, "Pengguna ini super admin. Cabut dulu peran super adminnya, baru blokir."),
  INACTIVE: failure(409, "Akun yang diblokir atau nonaktif tidak bisa diberi peran admin."),
  LAST: failure(409, "Ini super admin terakhir. Beri peran super admin ke orang lain dulu."),
  NO_ROLE: failure(404, "Peran admin itu tidak ditemukan."),
  EMAIL: failure(409, "Email itu sudah dipakai pengguna lain."),
  NOOP: failure(409, "Tidak ada yang berubah."),
};

const SUPER_ONLY = failure(403, "Hanya Super Admin yang boleh mengatur peran admin.");
const RBAC_FILE = "sql/014_admin_rbac.sql";
const GRANTS_FILE = "sql/015_admin_rbac_grants.sql";

/** Panggil fungsi sql/014; bila belum dipasang, galatnya menyebut berkas itu. */
async function callRbac<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (err instanceof Error && /PGRST202|42883|42P01|42703/.test(err.message)) throw new MissingAutopilotSchemaError(RBAC_FILE);
    // Versi awal sql/014 lupa memberi hak eksekusi ke service_role; sql/015 memperbaikinya.
    if (err instanceof Error && /42501/.test(err.message) && /dash_sa_/.test(err.message)) throw new MissingAutopilotSchemaError(GRANTS_FILE);
    throw err;
  }
}

const cleanText = (v: unknown, max: number): string | null =>
  typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null : null;

/** Lupakan semua cache tentang satu pengguna: sesi, keanggotaan, dan konteks platform. */
function forgetUser(userId: string): void {
  forgetUserStatus(userId);
  forgetMembership(userId);
  forgetPlatform(userId);
}

export async function actOnUser(
  actor: Pick<AdminActor, "userId" | "isSuper">,
  targetId: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; path?: string; expiresAt?: string } | Failure> {
  if (!ID.test(targetId)) return failure(400, "Id pengguna tidak valid.");
  if (!isRecord(body) || typeof body.action !== "string") return failure(400, "Tindakan tidak valid.");
  const adminId = actor.userId;

  let result: string;
  let extra: { path?: string; expiresAt?: string } = {};
  switch (body.action) {
    case "role": {
      // Peran platform (sql/014): null = bukan staf. Hanya Super Admin.
      if (!actor.isSuper) return SUPER_ONLY;
      if (body.role !== null && (typeof body.role !== "string" || !ROLE_ID_PATTERN.test(body.role))) return failure(400, "Peran admin tidak valid.");
      result = await callRbac<string>("dash_sa_user_platform_role", { p_actor: adminId, p_target: targetId, p_role: body.role, p_now: now });
      if (result === "ALREADY") return failure(409, "Pengguna ini sudah memegang peran itu.");
      break;
    }
    case "update": {
      const patch: { name?: string | null; email?: string | null } = {};
      if (body.name !== undefined) patch.name = cleanText(body.name, 80);
      if (body.email !== undefined) {
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (email && !EMAIL.test(email)) return failure(400, "Alamat email tidak valid.");
        patch.email = email || null;
      }
      if (Object.keys(patch).length === 0) return failure(400, "Tidak ada yang diubah.");
      result = await callRbac<string>("dash_sa_user_update", { p_actor: adminId, p_target: targetId, p_patch: patch, p_now: now });
      break;
    }
    case "ban": {
      const reason = parseReason(body.reason);
      if (typeof reason !== "string") return reason;
      result = await call<string>("dash_sa_user_ban", { p_actor: adminId, p_target: targetId, p_reason: reason, p_now: now });
      if (result === "ALREADY") return failure(409, "Pengguna ini sudah diblokir.");
      break;
    }
    case "unban":
      result = await call<string>("dash_sa_user_unban", { p_actor: adminId, p_target: targetId, p_now: now });
      if (result === "ALREADY") return failure(409, "Pengguna ini sudah aktif.");
      break;
    case "grant":
    case "revoke":
      if (!actor.isSuper) return SUPER_ONLY;
      result = await call<string>("dash_sa_user_role", { p_actor: adminId, p_target: targetId, p_super: body.action === "grant", p_now: now });
      if (result === "ALREADY") return failure(409, body.action === "grant" ? "Pengguna ini sudah super admin." : "Pengguna ini bukan super admin.");
      break;
    case "logout":
      result = await call<string>("dash_sa_user_logout", { p_actor: adminId, p_target: targetId, p_now: now });
      break;
    case "reset": {
      const { token, hash } = newToken();
      const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
      result = await call<string>("dash_sa_reset_create", { p_actor: adminId, p_target: targetId, p_token_hash: hash, p_expires: expiresAt, p_now: now });
      // Token hanya dikembalikan sekali di sini; yang tersimpan di database hanya hash-nya.
      extra = { path: `/reset-password/${token}`, expiresAt: expiresAt.toISOString() };
      break;
    }
    default:
      return failure(400, "Tindakan tidak valid.");
  }
  if (result !== "OK") return USER_ERRORS[result] ?? failure(409, "Tindakan ditolak.");
  forgetUser(targetId);
  return { ok: true, ...(body.action === "reset" ? extra : {}) };
}

/* ------------------------------------------------------------------ workspace */

const encodeNameCursor = (nama: string, id: string): string => Buffer.from(JSON.stringify([nama, id])).toString("base64url");
function decodeNameCursor(raw: string | null): { nama: string; id: string } | null {
  if (!raw || raw.length > 600) return null;
  try {
    const [nama, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [unknown, unknown];
    return typeof nama === "string" && typeof id === "string" && id ? { nama, id } : null;
  } catch {
    return null;
  }
}

export async function listWorkspaces(p: { q: string | null; cursor: string | null }): Promise<AdminWorkspaceListResponse> {
  const q = (p.q ?? "").trim().slice(0, 80);
  const cursor = decodeNameCursor(p.cursor);
  const [rows, plans] = await Promise.all([
    call<AdminWorkspaceDTO[]>("dash_sa_workspaces", {
      p_q: q ? likeEscape(q) : null,
      p_after_nama: cursor?.nama ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: ADMIN_PAGE_SIZE + 1,
    }),
    workspacePlans(),
  ]);
  const page = rows.slice(0, ADMIN_PAGE_SIZE).map((w) => ({
    ...w,
    suspendedAt: iso(w.suspendedAt),
    planId: plans[w.id]?.planId ?? null,
    planBerakhir: plans[w.id]?.planBerakhir ?? null,
  }));
  const last = page.at(-1);
  return { success: true, items: page, nextCursor: rows.length > ADMIN_PAGE_SIZE && last ? encodeNameCursor(last.nama, last.id) : null };
}

const WORKSPACE_ERRORS: Record<string, Failure> = {
  FORBIDDEN: failure(403, "Hanya super admin yang boleh melakukan ini."),
  NOT_FOUND: failure(404, "Workspace tidak ditemukan."),
  NO_USER: failure(404, "Pengguna dengan email atau username itu tidak ditemukan."),
  NOT_MEMBER: failure(409, "Pengguna itu bukan anggota workspace ini."),
};

export async function actOnWorkspace(adminId: string, workspaceId: string, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!ID.test(workspaceId)) return failure(400, "Id workspace tidak valid.");
  if (!isRecord(body) || typeof body.action !== "string") return failure(400, "Tindakan tidak valid.");

  if (body.action === "plan") return setWorkspacePlan(adminId, workspaceId, body, now);

  let result: string;
  switch (body.action) {
    case "suspend": {
      const reason = parseReason(body.reason);
      if (typeof reason !== "string") return reason;
      result = await call<string>("dash_sa_workspace_suspend", { p_actor: adminId, p_ws: workspaceId, p_reason: reason, p_now: now });
      if (result === "ALREADY") return failure(409, "Workspace ini sudah ditangguhkan.");
      break;
    }
    case "unsuspend":
      result = await call<string>("dash_sa_workspace_unsuspend", { p_actor: adminId, p_ws: workspaceId, p_now: now });
      if (result === "ALREADY") return failure(409, "Workspace ini tidak sedang ditangguhkan.");
      break;
    case "member": {
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      if (identifier.length < 3 || identifier.length > 254) return failure(400, "Isi email atau username pengguna.");
      if (body.role !== null && !ROLES.includes(body.role as Role)) return failure(400, "Peran tidak valid.");
      result = await call<string>("dash_sa_member_set", { p_actor: adminId, p_ws: workspaceId, p_identifier: identifier, p_role: body.role, p_now: now });
      break;
    }
    default:
      return failure(400, "Tindakan tidak valid.");
  }
  if (result !== "OK") return WORKSPACE_ERRORS[result] ?? failure(409, "Tindakan ditolak.");
  // Penangguhan dan keanggotaan memengaruhi banyak pengguna sekaligus: kosongkan semua cache konteks.
  forgetMembership();
  forgetPlatform();
  return { ok: true };
}

/* ------------------------------------------------------------------ sumber akun */

export async function listSources(): Promise<AdminSourceListResponse> {
  return { success: true, items: await call<AdminSourceDTO[]>("dash_sa_sources") };
}

const SOURCE_ERRORS: Record<string, Failure> = {
  FORBIDDEN: failure(403, "Hanya super admin yang boleh melakukan ini."),
  NOT_FOUND: failure(404, "Workspace SukaPost tidak ditemukan."),
  NO_TENANT: failure(404, "Workspace dashboard tujuan tidak ditemukan."),
  LEADER: failure(409, "Workspace ini memimpin kelompok yang masih berisi workspace lain. Pindahkan yang lain dulu."),
  ALREADY: failure(409, "Tautannya sudah seperti itu."),
};

export async function linkSource(adminId: string, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!isRecord(body) || typeof body.workspaceId !== "string" || !ID.test(body.workspaceId)) return failure(400, "Workspace SukaPost tidak valid.");
  if (body.tenantId !== null && (typeof body.tenantId !== "string" || !ID.test(body.tenantId))) return failure(400, "Workspace tujuan tidak valid.");
  const result = await call<string>("dash_sa_source_link", { p_actor: adminId, p_workspace: body.workspaceId, p_tenant: body.tenantId, p_now: now });
  if (result !== "OK") return SOURCE_ERRORS[result] ?? failure(409, "Tindakan ditolak.");
  // Peta workspace -> tenant dan daftar akun berubah untuk semua pengguna.
  forgetAccountCaches();
  forgetPublishAccounts();
  forgetMembership();
  return { ok: true };
}

/* ------------------------------------------------------------------ pengaturan dan audit */

export async function getSettings(): Promise<AdminSettingsResponse> {
  return { success: true, flags: await call<AdminFlags>("dash_sa_flags"), signupEnv: signupEnvEnabled() };
}

export async function saveSettings(adminId: string, body: unknown, now = new Date()): Promise<AdminSettingsResponse | Failure> {
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const patch: Partial<AdminFlags> = {};
  for (const key of ["signupOpen", "autopilotGlobal"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return failure(400, "Nilai saklar tidak valid.");
    patch[key] = body[key];
  }
  if (body.announcement !== undefined) {
    if (body.announcement !== null && typeof body.announcement !== "string") return failure(400, "Pengumuman tidak valid.");
    const text = (body.announcement ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > ADMIN_ANNOUNCEMENT_MAX) return failure(400, `Pengumuman maksimal ${ADMIN_ANNOUNCEMENT_MAX} karakter.`);
    patch.announcement = text || null;
  }
  if (Object.keys(patch).length === 0) return failure(400, "Tidak ada yang diubah.");
  const flags = await call<AdminFlags | null>("dash_sa_settings_set", { p_actor: adminId, p_patch: patch, p_now: now });
  if (!flags) return failure(403, "Hanya super admin yang boleh melakukan ini.");
  forgetPlatform();
  return { success: true, flags, signupEnv: signupEnvEnabled() };
}

export async function getAudit(cursorRaw: string | null): Promise<AdminAuditResponse> {
  const cursor = decodeCursor(cursorRaw);
  const rows = await call<AdminAuditDTO[]>("dash_sa_audit", { p_cursor_at: cursor?.at ?? null, p_cursor_id: cursor?.id ?? null, p_limit: ADMIN_PAGE_SIZE + 1 });
  const page = rows.slice(0, ADMIN_PAGE_SIZE).map((a) => ({ ...a, createdAt: utc(a.createdAt).toISOString() }));
  const last = page.at(-1);
  return { success: true, items: page, nextCursor: rows.length > ADMIN_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null };
}

/* ------------------------------------------------------------------ buat pengguna */

/** Admin membuat akun pengguna baru (tanpa workspace). Super Admin boleh langsung memberinya peran admin. */
export async function createUser(actor: Pick<AdminActor, "userId" | "isSuper">, body: unknown, now = new Date()): Promise<{ ok: true; id: string } | Failure> {
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) return failure(400, "Username 3-32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email && !EMAIL.test(email)) return failure(400, "Alamat email tidak valid.");
  const pwError = passwordError(body.password);
  if (pwError) return failure(400, pwError);
  const role = body.role ?? null;
  if (role !== null) {
    if (!actor.isSuper) return SUPER_ONLY;
    if (typeof role !== "string" || !ROLE_ID_PATTERN.test(role)) return failure(400, "Peran admin tidak valid.");
  }

  const made = await callRbac<{ status: string; id?: string }>("dash_sa_user_create", {
    p_actor: actor.userId,
    p_user: { username, email: email || null, name: cleanText(body.name, 80), passwordHash: await hashPassword(body.password as string) },
    p_now: now,
  });
  if (made.status === "USERNAME") return failure(409, "Username sudah dipakai. Pilih yang lain.");
  if (made.status === "EMAIL") return failure(409, "Email itu sudah dipakai pengguna lain.");
  if (made.status !== "OK" || !made.id) return USER_ERRORS[made.status] ?? failure(409, "Tindakan ditolak.");
  if (role) {
    const r = await callRbac<string>("dash_sa_user_platform_role", { p_actor: actor.userId, p_target: made.id, p_role: role, p_now: now });
    if (r !== "OK") return USER_ERRORS[r] ?? failure(409, "Akun dibuat, tetapi peran admin gagal dipasang.");
  }
  return { ok: true, id: made.id };
}

/* ------------------------------------------------------------------ peran dan hak akses */

/** Peran admin, staf yang memegangnya, dan apakah sql/014 sudah dipasang. */
export async function getRoles(): Promise<AdminRolesResponse> {
  try {
    const [roles, staff] = await Promise.all([callRbac<AdminRoleDTO[]>("dash_sa_roles", {}), callRbac<AdminStaffDTO[]>("dash_sa_staff", {})]);
    return { success: true, installed: true, roles, staff: staff.map((s) => ({ ...s, lastLoginAt: iso(s.lastLoginAt) })) };
  } catch (err) {
    // Hanya "sql/014 belum dipasang" yang jatuh ke mode satu peran; galat hak akses (sql/015) ditampilkan apa adanya.
    if (!(err instanceof MissingAutopilotSchemaError) || err.file !== RBAC_FILE) throw err;
    // Sebelum sql/014: satu-satunya peran adalah Super Admin; stafnya diambil dari daftar pengguna.
    const supers = await call<AdminUserDTO[]>("dash_sa_users", { p_q: null, p_status: "SUPERADMIN", p_cursor_at: null, p_cursor_id: null, p_limit: 100 });
    return {
      success: true,
      installed: false,
      roles: [{ id: "SUPERADMIN", nama: "Super Admin", deskripsi: "Akses penuh ke seluruh konsol.", izin: ["*"], sistem: true, urutan: 0, anggota: supers.length }],
      staff: supers.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        name: u.name,
        isActive: u.isActive,
        lastLoginAt: iso(u.lastLoginAt),
        platformRole: "SUPERADMIN",
        roleNama: "Super Admin",
      })),
    };
  }
}

const ROLE_ERRORS: Record<string, Failure> = {
  FORBIDDEN: SUPER_ONLY,
  NOT_FOUND: failure(404, "Peran tidak ditemukan."),
  SYSTEM: failure(409, "Peran Super Admin adalah peran sistem dan tidak bisa diubah atau dihapus."),
  INVALID: failure(400, "Data peran tidak valid."),
  IN_USE: failure(409, "Peran ini masih dipegang staf. Pindahkan mereka ke peran lain dulu."),
};

/** `{ action: "save", role: { id, nama, deskripsi, izin[] } }` | `{ action: "delete", id }`. Hanya Super Admin. */
export async function actOnRoles(actor: Pick<AdminActor, "userId" | "isSuper">, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!actor.isSuper) return SUPER_ONLY;
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  let result: string;
  if (body.action === "save") {
    const r = body.role;
    if (!isRecord(r)) return failure(400, "Data peran tidak valid.");
    const id = typeof r.id === "string" ? r.id.trim().toUpperCase() : "";
    if (!ROLE_ID_PATTERN.test(id)) return failure(400, "Kode peran 2-32 karakter: huruf besar, angka, atau garis bawah, diawali huruf.");
    const nama = cleanText(r.nama, 60);
    if (!nama || nama.length < 2) return failure(400, "Nama peran 2-60 karakter.");
    const deskripsi = cleanText(r.deskripsi, 300);
    if (!Array.isArray(r.izin) || !r.izin.every((p) => typeof p === "string" && (ASSIGNABLE_PERMS as string[]).includes(p))) {
      return failure(400, "Daftar izin tidak valid.");
    }
    if (r.izin.length === 0) return failure(400, "Pilih minimal satu izin.");
    result = await callRbac<string>("dash_sa_role_upsert", { p_actor: actor.userId, p_role: { id, nama, deskripsi, izin: r.izin }, p_now: now });
  } else if (body.action === "delete") {
    if (typeof body.id !== "string" || !ROLE_ID_PATTERN.test(body.id)) return failure(400, "Kode peran tidak valid.");
    result = await callRbac<string>("dash_sa_role_delete", { p_actor: actor.userId, p_id: body.id, p_now: now });
  } else {
    return failure(400, "Tindakan tidak valid.");
  }
  if (result !== "OK") return ROLE_ERRORS[result] ?? failure(409, "Tindakan ditolak.");
  // Izin peran berubah: konteks platform semua staf dibaca ulang.
  forgetPlatform();
  return { ok: true };
}

/* ------------------------------------------------------------------ konten lintas tenant */

const POST_STATUSES: PostStatusKey[] = ["SCHEDULED", "QUEUED", "PROCESSING", "PUBLISHED", "FAILED"];

/**
 * Antrean dan riwayat posting SEMUA tenant (dipanggil di luar lingkup tenant, jadi tanpa filter akun).
 * Termasuk posting dari SukaPost (baca-saja); hanya posting dashboard yang bisa dibatalkan/dikirim ulang.
 */
export async function listAllPosts(p: { scope: string | null; status: string | null; account: string | null; cursor: string | null }): Promise<ListResult | Failure> {
  if (p.status !== null && !POST_STATUSES.includes(p.status as PostStatusKey)) return failure(400, "Filter status tidak valid.");
  const account = p.account?.trim().replace(/^@/, "") || null;
  if (account && !/^[A-Za-z0-9_.]{1,60}$/.test(account)) return failure(400, "Username akun tidak valid.");
  return listPosts({
    scope: p.scope === "history" ? "history" : "upcoming",
    accountUsername: account,
    status: (p.status as PostStatusKey | null) ?? null,
    cursor: p.cursor,
    includeAll: true,
  });
}

/** `{ action: "cancel" | "retry", postId }` atas posting tenant mana pun. Tercatat di log posting dengan id admin. */
export async function actOnPost(adminId: string, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!isRecord(body) || typeof body.postId !== "string" || !ID.test(body.postId)) return failure(400, "Id posting tidak valid.");
  if (body.action === "cancel") return cancelPost({ userId: adminId, postId: body.postId }, now);
  if (body.action === "retry") {
    const r = await retryPost({ userId: adminId, postId: body.postId }, now);
    return r.ok ? { ok: true } : r;
  }
  return failure(400, "Tindakan tidak valid.");
}
