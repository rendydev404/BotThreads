/**
 * Hak akses konsol admin platform (sql/014_admin_rbac.sql). Tanpa impor server, aman untuk "use client".
 *
 * Setiap modul punya izin "<modul>.lihat" (buka halaman dan baca data) dan, bila ada tindakan,
 * "<modul>.kelola" (mengubah). SUPERADMIN memegang "*" (semua izin) dan satu-satunya yang boleh
 * mengatur peran admin (`akses.kelola`, sengaja tidak bisa diberikan ke peran lain).
 */

export type AdminModule =
  | "dashboard"
  | "pengguna"
  | "workspace"
  | "konten"
  | "buzzer"
  | "paket"
  | "tagihan"
  | "sumber"
  | "integrasi"
  | "sistem"
  | "audit"
  | "akses";

export type AdminPerm = `${AdminModule}.lihat` | `${AdminModule}.kelola`;

/** Izin yang bisa diberikan ke peran staf, dikelompokkan per modul (urutan = urutan tampil). */
export const PERM_CATALOG: { module: Exclude<AdminModule, "akses">; label: string; lihat: string; kelola: string | null }[] = [
  { module: "dashboard", label: "Ringkasan & KPI", lihat: "Melihat metrik platform dan pendapatan", kelola: null },
  { module: "pengguna", label: "Pengguna", lihat: "Melihat daftar dan detail pengguna", kelola: "Membuat, mengubah, memblokir, reset password, keluarkan sesi" },
  { module: "workspace", label: "Workspace", lihat: "Melihat workspace dan anggotanya", kelola: "Menangguhkan workspace dan mengatur anggota" },
  { module: "konten", label: "Konten & Antrean", lihat: "Melihat antrean dan riwayat posting semua tenant", kelola: "Membatalkan atau mengirim ulang posting" },
  { module: "buzzer", label: "Pengerahan Buzzer", lihat: "Melihat workspace buzzer, niche akun, dan riwayat pengerahan", kelola: "Mengerahkan buzzer dan mengatur niche/persona buzzer" },
  { module: "paket", label: "Paket & Harga", lihat: "Melihat paket dan harga", kelola: "Mengubah paket dan memasang paket ke workspace" },
  { module: "tagihan", label: "Transaksi & Tagihan", lihat: "Melihat invoice dan kas masuk", kelola: "Menyetujui, menyinkronkan, membatalkan tagihan" },
  { module: "sumber", label: "Sumber Akun Threads", lihat: "Melihat penautan sumber akun", kelola: "Menautkan atau melepas sumber akun" },
  { module: "integrasi", label: "Integrasi & API Keys", lihat: "Melihat status integrasi (kunci tetap tersamar)", kelola: "Mengubah kunci API dan konfigurasi integrasi" },
  { module: "sistem", label: "Saklar Sistem", lihat: "Melihat saklar platform", kelola: "Mengubah saklar, autopilot global, dan pengumuman" },
  { module: "audit", label: "Log Audit", lihat: "Melihat jejak audit platform", kelola: null },
];

/** Semua izin yang boleh dipasang ke peran staf (cermin dash_sa_izin_valid). */
export const ASSIGNABLE_PERMS: AdminPerm[] = PERM_CATALOG.flatMap((m) => [
  `${m.module}.lihat` as AdminPerm,
  ...(m.kelola ? [`${m.module}.kelola` as AdminPerm] : []),
]);

export const SUPER_ROLE = "SUPERADMIN";

/** Pemegang izin `perm`? `kelola` selalu mencakup `lihat` modul yang sama. */
export function hasPerm(izin: readonly string[] | null | undefined, perm: AdminPerm): boolean {
  if (!izin || izin.length === 0) return false;
  if (izin.includes("*")) return true;
  if (perm === "akses.kelola" || perm === "akses.lihat") return false;
  if (izin.includes(perm)) return true;
  const [mod, level] = perm.split(".");
  return level === "lihat" && izin.includes(`${mod}.kelola`);
}

export interface AdminRoleDTO {
  id: string;
  nama: string;
  deskripsi: string | null;
  izin: string[];
  sistem: boolean;
  urutan: number;
  /** Staf aktif yang memegang peran ini. */
  anggota: number;
}

export interface AdminStaffDTO {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  platformRole: string;
  roleNama: string;
}

export interface AdminRolesResponse {
  success: true;
  roles: AdminRoleDTO[];
  staff: AdminStaffDTO[];
  /** False = sql/014 belum dipasang: hanya peran Super Admin yang tersedia. */
  installed: boolean;
}

export const ROLE_ID_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;
