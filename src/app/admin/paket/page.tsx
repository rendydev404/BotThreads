import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { PlansTab } from "@/components/admin/plans-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Paket & Harga · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="paket">
      <PlansTab />
    </AdminPage>
  );
}
