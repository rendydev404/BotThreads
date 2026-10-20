import type { Metadata } from "next";
import { ThreadsPairDesktop } from "@/components/auth/threads-pair-desktop";

export const metadata: Metadata = {
  title: "Hubungkan Threads dari komputer | BotThreads",
  robots: { index: false, follow: false },
};

/** Opsional: komputer menampilkan QR, HP yang sudah masuk dashboard men-scan dan menyetujui. */
export default function ThreadsPairPage() {
  return <ThreadsPairDesktop />;
}
