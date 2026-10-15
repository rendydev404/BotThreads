import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { AccessTab } from "@/components/admin/access-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Peran & Hak Akses · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="akses">
      <AccessTab />
    </AdminPage>
  );
}
