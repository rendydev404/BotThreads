import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { SystemTab } from "@/components/admin/system-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Saklar Sistem · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="sistem">
      <SystemTab />
    </AdminPage>
  );
}
