import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { SourcesTab } from "@/components/admin/sources-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Sumber Akun Threads · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="sumber">
      <SourcesTab />
    </AdminPage>
  );
}
