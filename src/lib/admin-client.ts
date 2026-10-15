/**
 * Klien fetch bertipe untuk panel super admin (/api/admin/*). Aman dipakai di komponen "use client".
 * Semua endpoint menolak (403) pengguna yang bukan super admin. Galat dilempar sebagai `ContentApiError`.
 */
import type {
  AdminAuditResponse,
  AdminFlags,
  AdminOverviewResponse,
  AdminSettingsResponse,
  AdminSourceListResponse,
  AdminUserListResponse,
  AdminUserStatus,
  AdminWorkspaceListResponse,
} from "./admin-types";
import { call } from "./content-client";
import type { AdminPlansResponse, PlanDTO } from "./plan-types";
import type { Role } from "./request-ctx";

export const fetchAdminOverview = (signal?: AbortSignal) => call<AdminOverviewResponse>("/api/admin/overview", { signal });

export function listAdminUsers(p: { q?: string; status?: AdminUserStatus | null; cursor?: string | null } = {}, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.status) q.set("status", p.status);
  if (p.cursor) q.set("cursor", p.cursor);
  return call<AdminUserListResponse>(`/api/admin/users?${q}`, { signal });
}

const userAction = <T = { success: true }>(id: string, body: Record<string, unknown>) =>
  call<T>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) });

/** Blokir pengguna (alasan wajib, 5-300 karakter). Semua sesinya langsung gugur. */
export const banUser = (id: string, reason: string) => userAction(id, { action: "ban", reason });
export const unbanUser = (id: string) => userAction(id, { action: "unban" });
export const grantSuperAdmin = (id: string) => userAction(id, { action: "grant" });
export const revokeSuperAdmin = (id: string) => userAction(id, { action: "revoke" });
/** Keluarkan dari semua perangkat tanpa mengubah password. */
export const forceLogoutUser = (id: string) => userAction(id, { action: "logout" });
/** Tautan reset password sekali pakai (60 menit); `path` hanya ditampilkan sekali. */
export const adminResetLink = (id: string) => userAction<{ success: true; path: string; expiresAt: string }>(id, { action: "reset" });

export function listAdminWorkspaces(p: { q?: string; cursor?: string | null } = {}, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.cursor) q.set("cursor", p.cursor);
  return call<AdminWorkspaceListResponse>(`/api/admin/workspaces?${q}`, { signal });
}

const workspaceAction = (id: string, body: Record<string, unknown>) =>
  call<{ success: true }>(`/api/admin/workspaces/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) });

/** Tangguhkan workspace (alasan wajib): anggotanya kehilangan akses dan autopilotnya berhenti. */
export const suspendWorkspace = (id: string, reason: string) => workspaceAction(id, { action: "suspend", reason });
export const unsuspendWorkspace = (id: string) => workspaceAction(id, { action: "unsuspend" });
/** Tambah/ubah anggota lewat email atau username; `role: null` mengeluarkannya. */
export const setWorkspaceMember = (id: string, identifier: string, role: Role | null) => workspaceAction(id, { action: "member", identifier, role });

/** Pasang paket ke workspace. `planId: null` = kembali ke paket bawaan; `until` ISO atau null (tanpa batas waktu). */
export const setWorkspacePlan = (id: string, planId: string | null, until: string | null) => workspaceAction(id, { action: "plan", planId, until });

export const fetchAdminPlans = (signal?: AbortSignal) => call<AdminPlansResponse>("/api/admin/plans", { signal });
/** Buat atau ubah paket (kode `id` yang sama = ubah). */
export const saveAdminPlan = (plan: Omit<PlanDTO, "bawaan" | "dipakai">) =>
  call<{ success: true }>("/api/admin/plans", { method: "POST", body: JSON.stringify({ action: "save", plan }) });
/** Hapus paket yang tidak dipakai workspace mana pun (409 bila masih dipakai). */
export const deleteAdminPlan = (id: string) => call<{ success: true }>("/api/admin/plans", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
/** Paket bawaan untuk workspace tanpa paket sendiri; `null` = tanpa batas. */
export const setDefaultPlan = (id: string | null) => call<{ success: true }>("/api/admin/plans", { method: "POST", body: JSON.stringify({ action: "default", id }) });

export const listAdminSources = (signal?: AbortSignal) => call<AdminSourceListResponse>("/api/admin/sources", { signal });
/** Tautkan workspace SukaPost ke tenant dashboard; `tenantId: null` melepas tautan. */
export const linkAdminSource = (workspaceId: string, tenantId: string | null) =>
  call<{ success: true }>("/api/admin/sources", { method: "POST", body: JSON.stringify({ workspaceId, tenantId }) });

export const fetchAdminSettings = (signal?: AbortSignal) => call<AdminSettingsResponse>("/api/admin/settings", { signal });
/** Kirim hanya saklar yang berubah. Balasannya saklar terbaru. */
export const saveAdminSettings = (patch: Partial<AdminFlags>) =>
  call<AdminSettingsResponse>("/api/admin/settings", { method: "PUT", body: JSON.stringify(patch) });

import type { AdminBillingResponse, AdminIntegrationsResponse, InvoiceDTO } from "./billing-types";

/** Status kunci enkripsi token Threads (harus sama dengan worker auto-suka). */
export interface TokenKeyStatus {
  configured: boolean;
  matchesWorker: boolean | null;
}

export type AdminIntegrationsPayload = AdminIntegrationsResponse & { tokenKey: TokenKeyStatus };

export const fetchAdminAudit = (cursor?: string | null, signal?: AbortSignal) =>
  call<AdminAuditResponse>(`/api/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });

export const fetchAdminIntegrations = (signal?: AbortSignal) =>
  call<AdminIntegrationsPayload>("/api/admin/integrations", { signal });

export const saveAdminIntegrations = (body: Record<string, unknown>) =>
  call<AdminIntegrationsPayload>("/api/admin/integrations", { method: "PUT", body: JSON.stringify(body) });

export const fetchAdminBilling = (signal?: AbortSignal) =>
  call<AdminBillingResponse>("/api/admin/billing", { signal });

export const approveAdminInvoice = (invoiceId: string, notes?: string) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/admin/billing", {
    method: "POST",
    body: JSON.stringify({ action: "approve", invoiceId, notes }),
  });

export const syncAdminInvoice = (invoiceId: string) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/admin/billing", {
    method: "POST",
    body: JSON.stringify({ action: "sync", invoiceId }),
  });

export const cancelAdminInvoice = (invoiceId: string, notes?: string) =>
  call<{ success: true; invoice: InvoiceDTO }>("/api/admin/billing", {
    method: "POST",
    body: JSON.stringify({ action: "cancel", invoiceId, notes }),
  });

