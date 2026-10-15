import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { UsersTab } from "@/components/admin/users-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Pengguna · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="pengguna">
      <UsersTab />
    </AdminPage>
  );
}
