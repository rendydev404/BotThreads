import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { WorkspacesTab } from "@/components/admin/workspaces-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Workspace · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="workspace">
      <WorkspacesTab />
    </AdminPage>
  );
}
