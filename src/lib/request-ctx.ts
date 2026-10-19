/**
 * Konteks permintaan: siapa penggunanya, workspace mana, peran apa, dan akun mana yang boleh ia
 * sentuh. Semua route fitur dibungkus `withCtx`, yang (1) menolak permintaan tanpa sesi, (2) menegakkan
 * peran minimal, dan (3) menjalankan handler di dalam lingkup tenant (tenant-scope.ts) sehingga setiap
 * akses data dalam permintaan itu otomatis terbatas pada workspace dan akun pengguna (PRD FR-M1).
 *
 * Autentikasi sesi dan cek same-origin sudah dipaksa `proxy.ts`; di sini otorisasi.
 */
import type { NextRequest, NextResponse } from "next/server";
import { hasPerm, type AdminPerm } from "./admin-perms";
import { UNAUTHORIZED, getRequestUserId, jsonError } from "./api-auth";
import { SESSION_COOKIE } from "./auth";
import { isMissingAutopilotSchema } from "./autopilot-store";
import type { ApiError } from "./content-types";
import { platformCtx } from "./platform";
import { rpc } from "./supabase";
import { makeScope, runScoped } from "./tenant-scope";

export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Pemilik",
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Pengamat",
};

export interface WorkspaceRef {
  workspaceId: string;
  nama: string;
  role: Role;
}

export interface RequestCtx {
  userId: string;
  /**
   * Tenant aktif pengguna (kelompok workspace; id-nya adalah id workspace pemimpin kelompok).
   * Null = belum dibatasi (skema multi-user belum dipasang).
   */
  workspaceId: string | null;
  role: Role;
  /** Akun Threads yang boleh diakses; null = semua akun di workspace. */
  accountIds: string[] | null;
  /** Semua workspace tempat pengguna menjadi anggota (untuk pemilih workspace). */
  workspaces?: WorkspaceRef[];
  /** Staf platform (sql/010_superadmin.sql, peran per sql/014): boleh membuka konsol /admin. */
  superadmin?: boolean;
  /** Peran dan izin konsol admin; null bila bukan staf platform. */
  admin?: { role: string | null; roleNama: string | null; izin: string[] } | null;
  /** Workspace aktif sedang ditangguhkan super admin: tidak ada data yang boleh diakses. */
  suspended?: { workspaceId: string; reason: string | null };
  /** Pengumuman platform untuk ditampilkan di dashboard. */
  announcement?: string | null;
}

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

/** Peran pengguna minimal setingkat `min`? */
export const hasRole = (ctx: RequestCtx, min: Role): boolean => RANK[ctx.role] >= RANK[min];

/** Pengguna boleh mengakses akun ini? */
export const canAccessAccount = (ctx: RequestCtx, accountId: string): boolean =>
  ctx.accountIds === null || ctx.accountIds.includes(accountId);

/** Saring daftar akun menurut lingkup pengguna (tenant dan akun yang diizinkan). */
export function scopeAccounts<T extends { id: string; tenantId: string | null }>(ctx: RequestCtx, rows: T[]): T[] {
  return rows.filter((r) => canAccessAccount(ctx, r.id) && (ctx.workspaceId === null || r.tenantId === ctx.workspaceId));
}

export const FORBIDDEN = (): NextResponse<ApiError> =>
  jsonError(403, "Anda tidak punya izin untuk tindakan ini.");

/** Workspace semu untuk pengguna tanpa keanggotaan: tidak ada data yang cocok dengannya. */
export const NO_WORKSPACE = "__tanpa_workspace__";

interface RawMembership {
  workspaceId: string;
  nama: string;
  role: Role;
  accountScope: "SEMUA" | "PILIHAN";
  accountIds: string[] | null;
}

type Membership = Omit<RequestCtx, "userId">;

// Keanggotaan jarang berubah; cache singkat supaya tiap permintaan tidak menambah satu query.
// Perubahan peran/lingkup berlaku paling lambat TTL ini (atau langsung lewat `forgetMembership`).
const MEMBERSHIP_TTL_MS = 30_000;
const membershipCache = new Map<string, { at: number; value: Membership }>();

export function forgetMembership(userId?: string): void {
  if (userId) membershipCache.delete(userId);
  else membershipCache.clear();
}

/**
 * Keanggotaan pengguna dari database. Sebelum skema multi-user dipasang (sql/008_multiuser.sql),
 * setiap pengguna aktif diperlakukan seperti sebelumnya: pemilik atas semua akun. Setelah dipasang,
 * pengguna tanpa keanggotaan tidak melihat data apa pun.
 */
async function loadMembership(userId: string): Promise<Membership> {
  const hit = membershipCache.get(userId);
  if (hit && Date.now() - hit.at < MEMBERSHIP_TTL_MS) return hit.value;

  // Konteks platform dimuat bersamaan; galatnya dilempar (gagal tutup), kecuali skemanya belum dipasang.
  const platformPending = platformCtx(userId);
  let value: Membership;
  try {
    const raw = await rpc<{ lastWorkspaceId: string | null; memberships: RawMembership[] }>("dash_mu_ctx", { p_user: userId });
    const pick = raw.memberships.find((m) => m.workspaceId === raw.lastWorkspaceId) ?? raw.memberships[0];
    value = pick
      ? {
          workspaceId: pick.workspaceId,
          role: pick.role,
          accountIds: pick.accountScope === "PILIHAN" ? pick.accountIds ?? [] : null,
          workspaces: raw.memberships.map((m) => ({ workspaceId: m.workspaceId, nama: m.nama, role: m.role })),
        }
      : { workspaceId: NO_WORKSPACE, role: "VIEWER", accountIds: [], workspaces: [] };
  } catch (err) {
    if (!isMissingAutopilotSchema(err)) {
      void platformPending.catch(() => undefined);
      throw err;
    }
    value = { workspaceId: null, role: "OWNER", accountIds: null };
  }
  const platform = await platformPending;
  value = {
    ...value,
    superadmin: platform.superadmin,
    admin: platform.superadmin ? { role: platform.platformRole, roleNama: platform.roleNama, izin: platform.izin } : null,
    announcement: platform.flags.announcement,
  };
  if (value.workspaceId && platform.suspended.has(value.workspaceId)) {
    // Workspace aktif ditangguhkan: perlakukan seperti tanpa workspace (tidak ada data yang cocok),
    // tetapi daftar workspace tetap ada supaya pengguna bisa pindah ke workspace lain.
    value = {
      ...value,
      suspended: { workspaceId: value.workspaceId, reason: platform.suspended.get(value.workspaceId) ?? null },
      workspaceId: NO_WORKSPACE,
      role: "VIEWER",
      accountIds: [],
    };
  }
  membershipCache.set(userId, { at: Date.now(), value });
  if (membershipCache.size > 500) membershipCache.clear();
  return value;
}

/** Konteks pengguna dari cookie sesi; null bila belum masuk. */
export async function getCtx(request: NextRequest): Promise<RequestCtx | null> {
  const userId = await getRequestUserId(request);
  if (!userId) return null;
  return { userId, ...(await loadMembership(userId)) };
}

/**
 * Konteks pengguna tanpa sesi di permintaan ini (mis. callback OAuth yang terbuka di browser lain).
 * Hanya untuk pengguna yang identitasnya sudah dibuktikan dengan cara lain (state bertanda tangan).
 */
export async function ctxForUser(userId: string): Promise<RequestCtx> {
  return { userId, ...(await loadMembership(userId)) };
}

/** Pelaku konsol admin: id, peran platform, dan pemeriksa izin (sql/014_admin_rbac.sql). */
export interface AdminActor {
  userId: string;
  role: string | null;
  izin: string[];
  /** Peran SUPERADMIN (semua izin, termasuk mengatur peran admin lain). */
  isSuper: boolean;
  can: (perm: AdminPerm) => boolean;
}

/**
 * Bungkus handler konsol admin: sesi wajib ada, pelakunya staf platform aktif, dan (bila `perm` diisi)
 * memegang izin itu. Handler berjalan TANPA lingkup tenant (melihat semua workspace). Gagal memeriksa
 * peran = akses ditutup. Tindakan dengan izin berbeda per aksi memeriksa `admin.can()` sendiri.
 */
export function withAdmin<P = Record<string, never>>(
  perm: AdminPerm | null,
  handler: (request: NextRequest, admin: AdminActor, route: { params: Promise<P> }) => Promise<Response> | Response
) {
  return async (request: NextRequest, route: { params: Promise<P> } = { params: Promise.resolve({} as P) }): Promise<Response> => {
    // Dibaca di luar try/catch: sinyal "route dinamis" dari Next saat build tidak boleh tertelan.
    request.cookies.get(SESSION_COOKIE);
    let userId: string | null;
    let actor: AdminActor | null = null;
    try {
      userId = await getRequestUserId(request);
      if (userId) {
        const p = await platformCtx(userId);
        if (p.superadmin) {
          const izin = p.izin;
          actor = { userId, role: p.platformRole, izin, isSuper: izin.includes("*"), can: (x) => hasPerm(izin, x) };
        }
      }
    } catch (err) {
      console.error("[admin] gagal memeriksa peran:", err instanceof Error ? err.message : "galat tak dikenal");
      return jsonError(503, "Server sedang bermasalah. Coba lagi sebentar.");
    }
    if (!userId) return UNAUTHORIZED();
    if (!actor) return jsonError(403, "Halaman ini hanya untuk admin platform.");
    if (perm && !actor.can(perm)) return ADMIN_FORBIDDEN();
    return handler(request, actor, route);
  };
}

/** Staf platform tanpa izin modul ini (konsol memuat ulang profil untuk membedakannya dari peran yang dicabut). */
export const ADMIN_FORBIDDEN = (): NextResponse<ApiError> => jsonError(403, "Peran admin Anda tidak punya izin untuk tindakan ini.");

/** Kompatibilitas: semua staf platform, tanpa izin modul tertentu. */
export const withSuperAdmin = <P = Record<string, never>>(
  handler: (request: NextRequest, admin: AdminActor, route: { params: Promise<P> }) => Promise<Response> | Response
) => withAdmin<P>(null, handler);

/** Lingkup tenant untuk konteks pengguna (dipakai `runScoped`). */
export const scopeOf = (ctx: RequestCtx) => makeScope(ctx.workspaceId, ctx.accountIds);

type RouteArg<P> = { params: Promise<P> };

/**
 * Bungkus handler route: sesi wajib ada, peran minimal `min`, dan seluruh handler berjalan di dalam
 * lingkup tenant pengguna. Kegagalan memuat keanggotaan menutup akses (gagal tutup), bukan membukanya.
 */
export function withCtx<P = Record<string, never>>(
  min: Role,
  handler: (request: NextRequest, ctx: RequestCtx, route: RouteArg<P>) => Promise<Response> | Response
) {
  // Next selalu mengirim argumen kedua; nilai bawaan hanya memudahkan pemanggilan langsung di uji.
  return async (request: NextRequest, route: RouteArg<P> = { params: Promise.resolve({} as P) }): Promise<Response> => {
    // Dibaca di luar try/catch: sinyal "route dinamis" dari Next saat build tidak boleh tertelan.
    request.cookies.get(SESSION_COOKIE);
    let ctx: RequestCtx | null;
    try {
      ctx = await getCtx(request);
    } catch (err) {
      console.error("[ctx] gagal memuat keanggotaan:", err instanceof Error ? err.message : "galat tak dikenal");
      return jsonError(503, "Server sedang bermasalah. Coba lagi sebentar.");
    }
    if (!ctx) return UNAUTHORIZED();
    if (!hasRole(ctx, min)) return FORBIDDEN();
    const active = ctx;
    return runScoped(scopeOf(active), () => handler(request, active, route));
  };
}
