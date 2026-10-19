/**
 * Klien fetch bertipe untuk API tim, profil, pengaturan workspace, audit, undangan, dan reset password.
 * Aman dipakai di komponen "use client" (hanya `import type` dari modul server).
 */
import { call } from "./content-client";
import type { WorkspacePlanResponse } from "./plan-types";
import type { Role, WorkspaceRef } from "./request-ctx";
import type { AuditResponse, BrandSettings, TeamResponse, WorkspaceSettingsResponse } from "./team-service";
import type { InvitePeek, InviteRow } from "./team-store";

export type { Role, WorkspaceRef, AuditResponse, BrandSettings, TeamResponse, WorkspaceSettingsResponse, InvitePeek, InviteRow };
export type { AuditRow, MemberRow } from "./team-store";

/** Label peran untuk UI (salinan dari request-ctx.ts supaya modul server tidak ikut terbundel). */
export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Pemilik",
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Pengamat",
};

export const ROLE_HINTS: Record<Role, string> = {
  OWNER: "Semua akses, termasuk mengatur Pemilik lain dan menghapus baris statistik.",
  ADMIN: "Mengelola tim, pengaturan workspace, dan jeda semua autopilot.",
  EDITOR: "Membuat, menjadwalkan, mengubah, dan membatalkan posting; mengatur autopilot.",
  VIEWER: "Melihat data dan membuat draf, tanpa bisa memposting atau mengubah pengaturan.",
};

export interface MeResponse {
  success: true;
  user: { id: string; username: string; name: string | null; email: string | null };
  role: Role;
  roleLabel: string;
  workspaceId: string | null;
  /** Skema multi-user terpasang (peran dan pembatasan akun berlaku). */
  multiUser: boolean;
  /** False = pengguna belum menjadi anggota workspace mana pun, atau workspace aktifnya ditangguhkan. */
  hasAccess: boolean;
  /** Staf platform: boleh membuka konsol /admin. */
  superadmin: boolean;
  /** Peran dan izin konsol admin ("*" = semua); null bila bukan staf. */
  admin: { role: string | null; roleNama: string | null; izin: string[] } | null;
  /** Workspace aktif sedang ditangguhkan pengelola (dengan alasannya); null bila tidak. */
  suspended: { workspaceId: string; reason: string | null } | null;
  /** Pengumuman dari pengelola platform; null bila tidak ada. */
  announcement: string | null;
  /** True = pengguna dibatasi ke akun tertentu. */
  accountScoped: boolean;
  /** Jumlah akun Threads yang terlihat pengguna ini; null bila gagal dihitung. */
  accountCount: number | null;
  workspaces: WorkspaceRef[];
  /** Tombol "Masuk dengan Google" tersedia. */
  google: boolean;
}

export const fetchMe = (signal?: AbortSignal) => call<MeResponse>("/api/auth/me", { signal });

/** Pindah workspace aktif (muat ulang halaman setelah berhasil). */
export const switchWorkspace = (workspaceId: string) =>
  call<{ success: true }>("/api/auth/me", { method: "POST", body: JSON.stringify({ action: "workspace", workspaceId }) });

export const changePassword = (current: string, next: string) =>
  call<{ success: true }>("/api/auth/me", { method: "POST", body: JSON.stringify({ action: "password", current, next }) });

export const fetchTeam = (signal?: AbortSignal) => call<TeamResponse>("/api/team", { signal });

/**
 * Balasan memuat `path` tautan undangan yang hanya ditampilkan sekali (gabungkan dengan `location.origin`)
 * dan baris undangannya; undangan lama untuk email yang sama digantikan.
 */
export const inviteMember = (body: { email: string; role: Exclude<Role, "OWNER">; accountIds?: string[] | null }) =>
  call<{ success: true; path: string; expiresAt: string; invite: InviteRow }>("/api/team", { method: "POST", body: JSON.stringify(body) });

export const revokeInvite = (id: string) =>
  call<{ success: true }>(`/api/team/invites/${encodeURIComponent(id)}`, { method: "DELETE" });

/** `accountIds` null/tidak diisi = semua akun. */
export const updateMember = (userId: string, body: { role: Role; accountIds?: string[] | null }) =>
  call<{ success: true }>(`/api/team/members/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(body) });

export const removeMember = (userId: string) =>
  call<{ success: true }>(`/api/team/members/${encodeURIComponent(userId)}`, { method: "DELETE" });

/** Tautan reset password untuk anggota (sekali pakai, 60 menit); `path` hanya ditampilkan sekali. */
export const createResetLink = (userId: string) =>
  call<{ success: true; path: string; expiresAt: string }>(`/api/team/members/${encodeURIComponent(userId)}`, { method: "POST" });

export const fetchWorkspaceSettings = (signal?: AbortSignal) =>
  call<WorkspaceSettingsResponse>("/api/workspace/settings", { signal });

export const saveWorkspaceSettings = (body: { namaBrand: string; deskripsiBrand: string | null; topikTerlarang: string[] }) =>
  call<{ success: true; settings: BrandSettings }>("/api/workspace/settings", { method: "PUT", body: JSON.stringify(body) });

/** Paket workspace aktif beserta pemakaiannya (akun ber-autopilot, anggota). */
export const fetchWorkspacePlan = (signal?: AbortSignal) => call<WorkspacePlanResponse>("/api/workspace/plan", { signal });

export const fetchAudit = (cursor?: string | null, signal?: AbortSignal) =>
  call<AuditResponse>(`/api/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });

/* ---- halaman publik (tanpa sesi) ---- */

export const peekInvite = (token: string) =>
  call<{ success: true; invite: InvitePeek; google: boolean }>(`/api/auth/invite?token=${encodeURIComponent(token)}`);

/** Pengguna baru: sertakan username + password (langsung masuk). Email yang sudah punya akun: cukup token. */
export const acceptInvite = (body: { token: string; username?: string; name?: string; password?: string }) =>
  call<{ success: true; signedIn: boolean }>("/api/auth/invite", { method: "POST", body: JSON.stringify(body) });

/** Daftar mandiri: akun + workspace baru; sesi langsung dipasang server. */
export const registerAccount = (body: { email: string; username: string; name?: string; brand: string; password: string }) =>
  call<{ success: true }>("/api/auth/register", { method: "POST", body: JSON.stringify(body) });

import type { BillingCycleMonths, InvoiceDTO, PaymentMethodId, WorkspaceBillingResponse } from "./billing-types";
import type { PublicPlansResponse } from "./plan-types";
import type { ConnectedThreadsAccountDTO, WorkspaceThreadsAccountsResponse } from "./threads-connect";

export const resetPasswordWithToken = (token: string, password: string) =>
  call<{ success: true }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });

export const fetchPublicPlans = (signal?: AbortSignal) =>
  call<PublicPlansResponse>("/api/plans", { signal });

export const fetchWorkspaceBilling = (signal?: AbortSignal) =>
  call<WorkspaceBillingResponse>("/api/billing", { signal });

export const createBillingCheckout = (body: { planId: string; months: BillingCycleMonths; method: PaymentMethodId }) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/billing", { method: "POST", body: JSON.stringify({ action: "checkout", ...body }) });

/** Buat kode bayar baru / ganti metode untuk tagihan yang belum dibayar. */
export const payBillingInvoice = (invoiceId: string, method: PaymentMethodId) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "pay", invoiceId, method }),
  });

/** Cek status pembayaran tagihan ke Midtrans (tagihan lunas otomatis bila sudah dibayar). */
export const syncBillingInvoice = (invoiceId: string) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "sync", invoiceId }),
  });

export const cancelBillingInvoice = (invoiceId: string) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "cancel", invoiceId }),
  });

export const fetchConnectedThreadsAccounts = (signal?: AbortSignal) =>
  call<WorkspaceThreadsAccountsResponse>("/api/threads/connect", { signal });

export const connectWorkspaceThreadsAccount = (body: { accessToken: string }) =>
  call<{ success: true; account: ConnectedThreadsAccountDTO }>("/api/threads/connect", { method: "POST", body: JSON.stringify(body) });

export const syncWorkspaceThreadsAccount = (accountId: string) =>
  call<{ success: true; account: Pick<ConnectedThreadsAccountDTO, "id" | "username" | "displayName" | "avatarUrl"> }>(
    "/api/threads/connect",
    { method: "PATCH", body: JSON.stringify({ accountId }) }
  );

export const removeWorkspaceThreadsAccount = (accountId: string) =>
  call<{ success: true }>("/api/threads/connect", { method: "DELETE", body: JSON.stringify({ accountId }) });
