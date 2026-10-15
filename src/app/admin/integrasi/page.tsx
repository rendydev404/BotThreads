import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { IntegrationsTab } from "@/components/admin/integrations-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Integrasi & API Keys · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="integrasi">
      <IntegrationsTab />
    </AdminPage>
  );
}
