/**
 * Kontrak data paket langganan (dipakai server dan klien). Tanpa impor server, aman untuk "use client".
 */

export interface PlanDTO {
  /** Slug: huruf kecil, angka, tanda hubung (2-32 karakter). */
  id: string;
  nama: string;
  deskripsi: string | null;
  /** Label promosi yang ditentukan super admin. */
  label: "REKOMENDASI" | "TERLARIS" | null;
  /** Rupiah per bulan; 0 = gratis. Hanya untuk ditampilkan. */
  hargaBulanan: number;
  /** Akun Threads yang autopilot-nya boleh menyala bersamaan. */
  maxAkun: number;
  /** Posting otomatis per akun per hari (1-6). */
  maxPostingPerHari: number;
  /** Anggota tim termasuk undangan yang belum diterima. */
  maxAnggota: number;
  /** False = hanya mode Tinjau dulu. */
  modeOtomatis: boolean;
  /** Ditampilkan di halaman perkenalan. */
  publik: boolean;
  aktif: boolean;
  urutan: number;
  /** Paket bawaan untuk workspace yang belum dipasangi paket. */
  bawaan: boolean;
  /** Jumlah workspace yang memakai paket ini. */
  dipakai: number;
}

export type PlanSummary = Pick<PlanDTO, "id" | "nama" | "hargaBulanan" | "maxAkun" | "maxPostingPerHari" | "maxAnggota" | "modeOtomatis">;

/** Paket yang berlaku untuk satu workspace beserta pemakaiannya. `plan` null = tanpa batas. */
export interface PlanLimits {
  plan: PlanSummary | null;
  /** True = workspace belum dipasangi paket sendiri dan mengikuti paket bawaan platform. */
  bawaan: boolean;
  /** ISO; null = tanpa batas waktu. */
  berakhir: string | null;
  /** Masa berlaku paket sudah lewat: autopilot berhenti sampai diperpanjang. */
  kedaluwarsa: boolean;
  pakai: { akun: number; anggota: number };
}

export interface WorkspacePlanResponse extends PlanLimits {
  success: true;
}

export interface PublicPlansResponse {
  success: true;
  items: Pick<PlanDTO, "id" | "nama" | "deskripsi" | "label" | "hargaBulanan" | "maxAkun" | "maxPostingPerHari" | "maxAnggota" | "modeOtomatis">[];
}

export interface AdminPlansResponse {
  success: true;
  /** False = sql/011_plans.sql belum dipasang. */
  installed: boolean;
  items: PlanDTO[];
}

export const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
export const PLAN_NAME_MAX = 40;
export const PLAN_DESC_MAX = 160;
export const PLAN_POSTS_MAX = 6;

/** "Rp149.000" atau "Gratis". */
export const formatRupiah = (n: number): string => (n <= 0 ? "Gratis" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
