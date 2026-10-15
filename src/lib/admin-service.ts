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
const STATUSES: AdminUserStatus[] = ["AKTIF", "DIBLOKIR", "NONAKTIF", "SUPERADMIN"];

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
  FORBIDDEN: failure(403, "Hanya super admin yang boleh melakukan ini."),
  NOT_FOUND: failure(404, "Pengguna tidak ditemukan."),
  SELF: failure(409, "Anda tidak bisa memblokir akun sendiri."),
  SUPERADMIN: failure(409, "Pengguna ini super admin. Cabut dulu peran super adminnya, baru blokir."),
  INACTIVE: failure(409, "Akun yang diblokir atau nonaktif tidak bisa dijadikan super admin."),
  LAST: failure(409, "Ini super admin terakhir. Beri peran super admin ke orang lain dulu."),
};

/** Lupakan semua cache tentang satu pengguna: sesi, keanggotaan, dan konteks platform. */
function forgetUser(userId: string): void {
  forgetUserStatus(userId);
  forgetMembership(userId);
  forgetPlatform(userId);
}

export async function actOnUser(
  adminId: string,
  targetId: string,
  body: unknown,
  now = new Date()
): Promise<{ ok: true; path?: string; expiresAt?: string } | Failure> {
  if (!ID.test(targetId)) return failure(400, "Id pengguna tidak valid.");
  if (!isRecord(body) || typeof body.action !== "string") return failure(400, "Tindakan tidak valid.");

  let result: string;
  let extra: { path?: string; expiresAt?: string } = {};
  switch (body.action) {
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
