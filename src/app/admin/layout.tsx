import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/console-shell";

/**
 * Isi konsol baru dirender setelah profil dan izin admin terbaca di peramban (sengaja: data admin tidak
 * boleh dimuat sebelum peran diketahui), jadi navigasi ke /admin/* boleh menunggu. Lihat
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Konsol Admin · BotThreads",
  robots: { index: false, follow: false },
};

/**
 * Konsol admin platform: aplikasi terpisah dari dashboard pelanggan (kerangka, menu, dan URL sendiri
 * di bawah /admin). Hanya staf platform yang bisa membukanya; izin tiap modul diatur di Peran & Hak Akses.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminConsole>{children}</AdminConsole>;
}
