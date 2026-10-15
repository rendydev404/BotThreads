import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { BillingTab } from "@/components/admin/billing-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Transaksi & Tagihan · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="transaksi">
      <BillingTab />
    </AdminPage>
  );
}
