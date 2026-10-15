/**
 * Kontrak data panel super admin (dipakai server dan klien). Tanpa impor server, aman untuk "use client".
 */
import type { SaaSKpiMetrics } from "./billing-types";
import type { Role } from "./request-ctx";

export interface AdminFlags {
  signupOpen: boolean;
  autopilotGlobal: boolean;
  announcement: string | null;
}

export interface AdminOverviewResponse {
  success: true;
  users: { total: number; aktif: number; diblokir: number; superadmin: number; baru7Hari: number; masuk24Jam: number };
  workspaces: { total: number; ditangguhkan: number; tanpaAkun: number };
  accounts: { total: number; tanpaPemilik: number };
  autopilot: {
    otomatis: number;
    tinjau: number;
    dijeda: number;
    /** ISO; null = penjadwal belum pernah berjalan. */
    tickTerakhir: string | null;
    /** Jumlah slot per status dalam 24 jam ke belakang dan ke depan. */
    slot24Jam: Record<string, number>;
  };
  flags: AdminFlags;
  /** SIGNUP_ENABLED di server; pendaftaran baru terbuka bila ini DAN flags.signupOpen menyala. */
  signupEnv: boolean;
  /** CONTENT_PUBLISH_ENABLED di server. */
  publishEnv: boolean;
  serverNow: string;
  /** Metrik KPI SaaS standar industri (MRR, ARR, ARPU, Konversi, Churn Risk, Aktivasi, SLA). */
  kpi?: SaaSKpiMetrics;
}

export type AdminUserStatus = "AKTIF" | "DIBLOKIR" | "NONAKTIF" | "SUPERADMIN" | "STAF";
export const ADMIN_USER_STATUS_LABEL: Record<AdminUserStatus, string> = {
  AKTIF: "Aktif",
  DIBLOKIR: "Diblokir",
  NONAKTIF: "Nonaktif",
  SUPERADMIN: "Super admin",
  STAF: "Staf admin",
};

export interface AdminUserDTO {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  superadmin: boolean;
  /** Peran admin platform (sql/014); null = bukan staf. Tidak ada sebelum sql/014 dipasang. */
  platformRole?: string | null;
  roleNama?: string | null;
  /** ISO; ada = diblokir super admin. */
  bannedAt: string | null;
  bannedReason: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  /** Pernah masuk dengan Google. */
  google: boolean;
  workspaces: { workspaceId: string; nama: string; role: Role }[];
}

export interface AdminUserListResponse {
  success: true;
  items: AdminUserDTO[];
  nextCursor: string | null;
  /** Id pengguna yang sedang masuk (tindakan atas diri sendiri dibatasi). */
  me: string;
}

/** ban = blokir (wajib alasan), unban = buka blokir/aktifkan, grant/revoke = peran super admin,
 *  logout = keluarkan dari semua perangkat, reset = buat tautan reset password sekali pakai. */
export type AdminUserAction = "ban" | "unban" | "grant" | "revoke" | "logout" | "reset" | "role" | "update";

export interface AdminWorkspaceDTO {
  id: string;
  nama: string;
  /** ISO; ada = ditangguhkan. */
  suspendedAt: string | null;
  suspendedReason: string | null;
  autopilotAktif: boolean;
  anggota: number;
  akun: number;
  /** Akun yang autopilot-nya menyala. */
  autopilotAkun: number;
  members: { id: string; username: string; email: string | null; role: Role }[];
  /** Paket yang dipasang khusus untuk workspace ini; null = mengikuti paket bawaan (atau tanpa batas). */
  planId: string | null;
  /** ISO; null = tanpa batas waktu. */
  planBerakhir: string | null;
}

export interface AdminWorkspaceListResponse {
  success: true;
  items: AdminWorkspaceDTO[];
  nextCursor: string | null;
}

/** suspend (wajib alasan) | unsuspend | member (identifier = email/username; role null = keluarkan) |
 *  plan (planId null = paket bawaan; until ISO atau null = tanpa batas waktu). */
export type AdminWorkspaceAction = "suspend" | "unsuspend" | "member" | "plan";

/** Workspace SukaPost tempat akun Threads berada; ditautkan ke tenant dashboard supaya akunnya tampil. */
export interface AdminSourceDTO {
  workspaceId: string;
  nama: string;
  akun: number;
  /** Tenant dashboard tempat workspace ini ditautkan; null = belum ditautkan. */
  tenantId: string | null;
  tenantNama: string | null;
  /** Pemimpin kelompok yang masih punya workspace lain: tidak bisa dipindah atau dilepas. */
  pemimpin: boolean;
}

export interface AdminSourceListResponse {
  success: true;
  items: AdminSourceDTO[];
}

export interface AdminSettingsResponse {
  success: true;
  flags: AdminFlags;
  signupEnv: boolean;
}

export interface AdminAuditDTO {
  id: string;
  actor: string;
  actorName: string;
  action: string;
  targetType: "PENGGUNA" | "WORKSPACE" | "SUMBER" | "SISTEM" | "PAKET" | "TAGIHAN" | "AKSES";
  targetId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditResponse {
  success: true;
  items: AdminAuditDTO[];
  nextCursor: string | null;
}

/** Label tindakan audit platform untuk ditampilkan. */
export const ADMIN_ACTION_LABEL: Record<string, string> = {
  SUPERADMIN_AWAL: "Super admin pertama ditetapkan",
  PENGGUNA_BLOKIR: "Memblokir pengguna",
  PENGGUNA_BUKA_BLOKIR: "Membuka blokir pengguna",
  SUPERADMIN_BERI: "Memberi peran super admin",
  SUPERADMIN_CABUT: "Mencabut peran super admin",
  PENGGUNA_KELUARKAN: "Mengeluarkan pengguna dari semua perangkat",
  PENGGUNA_TAUTAN_RESET: "Membuat tautan reset password",
  WORKSPACE_TANGGUHKAN: "Menangguhkan workspace",
  WORKSPACE_PULIHKAN: "Memulihkan workspace",
  WORKSPACE_ANGGOTA_ATUR: "Mengatur anggota workspace",
  WORKSPACE_ANGGOTA_HAPUS: "Mengeluarkan anggota workspace",
  SUMBER_TAUTKAN: "Menautkan sumber akun",
  SISTEM_PENGATURAN: "Mengubah pengaturan sistem",
  PAKET_SIMPAN: "Menyimpan paket",
  PAKET_HAPUS: "Menghapus paket",
  PAKET_BAWAAN: "Menetapkan paket bawaan",
  WORKSPACE_PAKET: "Memasang paket ke workspace",
  TAGIHAN_BUAT: "Membuat tagihan langganan",
  TAGIHAN_LUNAS: "Melunasi tagihan & mengaktifkan paket",
  TAGIHAN_BATAL: "Membatalkan tagihan langganan",
  INTEGRASI_SIMPAN: "Menyimpan konfigurasi integrasi & API keys",
  THREADS_HUBUNGKAN: "Menghubungkan akun Threads baru",
  PENGGUNA_BUAT: "Membuat akun pengguna",
  PENGGUNA_UBAH: "Mengubah profil pengguna",
  AKSES_PERAN_PENGGUNA: "Mengubah peran admin pengguna",
  AKSES_PERAN_BUAT: "Membuat peran admin",
  AKSES_PERAN_UBAH: "Mengubah hak akses peran admin",
  AKSES_PERAN_HAPUS: "Menghapus peran admin",
};

export const ADMIN_REASON_MIN = 5;
export const ADMIN_REASON_MAX = 300;
export const ADMIN_ANNOUNCEMENT_MAX = 300;
export const ADMIN_PAGE_SIZE = 25;
