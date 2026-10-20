/**
 * Daftar modul konsol admin: satu sumber untuk sidebar, pencarian cepat (Ctrl+K), judul halaman, dan
 * pemeriksaan izin per halaman. Setiap modul punya URL sendiri di bawah /admin.
 */
import {
  BarChart3,
  Building2,
  FileText,
  KeyRound,
  Link2,
  Megaphone,
  Package,
  Receipt,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { AdminPerm } from "@/lib/admin-perms";
import type { AdminTabKey } from "./shared";

export interface AdminModuleDef {
  key: AdminTabKey;
  href: string;
  label: string;
  /** Satu kalimat: apa yang dikerjakan di modul ini. */
  subtitle: string;
  group: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Izin minimal untuk membuka modul. */
  perm: AdminPerm;
  /** Kata kunci tambahan untuk pencarian cepat. */
  keywords: string;
}

export const ADMIN_GROUPS = ["Ringkasan", "Pelanggan", "Konten", "Bisnis", "Platform"] as const;

export const ADMIN_MODULES: AdminModuleDef[] = [
  {
    key: "ringkasan",
    href: "/admin",
    label: "Ringkasan",
    subtitle: "Kesehatan platform dan metrik bisnis (MRR, konversi, SLA autopilot) dalam satu layar.",
    group: "Ringkasan",
    Icon: BarChart3,
    perm: "dashboard.lihat",
    keywords: "dashboard kpi mrr arr arpu metrik overview",
  },
  {
    key: "pengguna",
    href: "/admin/pengguna",
    label: "Pengguna",
    subtitle: "Semua akun terdaftar: buat akun, ubah profil, blokir, reset password, dan keluarkan sesi.",
    group: "Pelanggan",
    Icon: Users,
    perm: "pengguna.lihat",
    keywords: "user akun blokir reset password sesi",
  },
  {
    key: "workspace",
    href: "/admin/workspace",
    label: "Workspace",
    subtitle: "Tenant pelanggan: anggota, paket aktif, dan penangguhan.",
    group: "Pelanggan",
    Icon: Building2,
    perm: "workspace.lihat",
    keywords: "tenant brand anggota tangguhkan suspend",
  },
  {
    key: "sumber",
    href: "/admin/sumber",
    label: "Sumber Akun Threads",
    subtitle: "Tautkan workspace SukaPost (tempat akun Threads berada) ke tenant dashboard.",
    group: "Pelanggan",
    Icon: Link2,
    perm: "sumber.lihat",
    keywords: "threads sukapost tautan source",
  },
  {
    key: "konten",
    href: "/admin/konten",
    label: "Konten & Antrean",
    subtitle: "Antrean dan riwayat posting semua tenant: pantau kegagalan, batalkan, atau kirim ulang.",
    group: "Konten",
    Icon: FileText,
    perm: "konten.lihat",
    keywords: "posting post antrean queue jadwal gagal moderasi",
  },
  {
    key: "buzzer",
    href: "/admin/buzzer",
    label: "Pengerahan Buzzer",
    subtitle: "Kerahkan akun dari Workspace Buzzer untuk meramaikan postingan target dengan komentar, repost, dan quote lintas-niche.",
    group: "Konten",
    Icon: Megaphone,
    perm: "buzzer.lihat",
    keywords: "buzzer ramaikan komentar komen repost quote share lintas niche",
  },
  {
    key: "paket",
    href: "/admin/paket",
    label: "Paket & Harga",
    subtitle: "Paket sewa, harga bulanan, kuota akun, batas posting harian, dan paket bawaan.",
    group: "Bisnis",
    Icon: Package,
    perm: "paket.lihat",
    keywords: "plan harga pricing kuota",
  },
  {
    key: "transaksi",
    href: "/admin/transaksi",
    label: "Transaksi & Tagihan",
    subtitle: "Invoice pelanggan, kas masuk, verifikasi pembayaran manual, dan status Midtrans.",
    group: "Bisnis",
    Icon: Receipt,
    perm: "tagihan.lihat",
    keywords: "billing invoice pembayaran midtrans qris virtual account tagihan",
  },
  {
    key: "akses",
    href: "/admin/akses",
    label: "Peran & Hak Akses",
    subtitle: "Atur peran admin, izin tiap modul, dan siapa saja yang menjadi staf platform.",
    group: "Platform",
    Icon: ShieldCheck,
    perm: "akses.lihat",
    keywords: "rbac role izin permission staf admin",
  },
  {
    key: "integrasi",
    href: "/admin/integrasi",
    label: "Integrasi & API Keys",
    subtitle: "Kunci Midtrans (pembayaran), Google OAuth (masuk), dan Meta Threads (hubungkan akun).",
    group: "Platform",
    Icon: KeyRound,
    perm: "integrasi.lihat",
    keywords: "api key midtrans google oauth meta threads",
  },
  {
    key: "sistem",
    href: "/admin/sistem",
    label: "Saklar Sistem",
    subtitle: "Pendaftaran mandiri, saklar darurat autopilot, dan pengumuman ke semua pengguna.",
    group: "Platform",
    Icon: SlidersHorizontal,
    perm: "sistem.lihat",
    keywords: "setting pengaturan pengumuman announcement darurat signup",
  },
  {
    key: "audit",
    href: "/admin/audit",
    label: "Log Audit",
    subtitle: "Jejak permanen setiap tindakan admin, pembayaran, dan perubahan konfigurasi.",
    group: "Platform",
    Icon: ScrollText,
    perm: "audit.lihat",
    keywords: "log riwayat history jejak",
  },
];

export const moduleByKey = (key: AdminTabKey): AdminModuleDef => ADMIN_MODULES.find((m) => m.key === key) ?? ADMIN_MODULES[0];

/** Modul untuk sebuah path (sub-path ikut modul induknya). */
export function moduleForPath(pathname: string): AdminModuleDef | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin") return ADMIN_MODULES[0];
  return ADMIN_MODULES.find((m) => m.href !== "/admin" && (path === m.href || path.startsWith(`${m.href}/`))) ?? null;
}
