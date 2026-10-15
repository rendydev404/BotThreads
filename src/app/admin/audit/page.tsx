import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { AuditTab } from "@/components/admin/audit-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Log Audit · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="audit">
      <AuditTab />
    </AdminPage>
  );
}
