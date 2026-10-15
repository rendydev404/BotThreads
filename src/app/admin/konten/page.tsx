import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { ContentTab } from "@/components/admin/content-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Konten & Antrean · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="konten">
      <ContentTab />
    </AdminPage>
  );
}
