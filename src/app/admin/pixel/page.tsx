import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { PixelTab } from "@/components/admin/pixel-tab";

// Menunggu izin admin di klien (lihat admin/layout.tsx).
export const instant = false;

export const metadata: Metadata = { title: "Meta Pixel · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="pixel">
      <PixelTab />
    </AdminPage>
  );
}
