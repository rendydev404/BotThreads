import type { Metadata } from "next";
import { AdminPage } from "@/components/admin/console-shell";
import { BuzzerTab } from "@/components/admin/buzzer-tab";

export const instant = false;

export const metadata: Metadata = { title: "Pengerahan Buzzer · Konsol Admin BotThreads" };

export default function Page() {
  return (
    <AdminPage module="buzzer">
      <BuzzerTab />
    </AdminPage>
  );
}
