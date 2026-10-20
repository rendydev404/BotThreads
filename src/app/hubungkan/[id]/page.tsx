import type { Metadata } from "next";
import { Suspense } from "react";
import { ThreadsPairApprove } from "@/components/auth/threads-pair-approve";

export const metadata: Metadata = {
  title: "Setujui hubungkan Threads | BotThreads",
  robots: { index: false, follow: false },
  // Id pairing ada di alamat halaman: jangan ikut terkirim sebagai Referer.
  referrer: "no-referrer",
};

type Props = { params: Promise<{ id: string }> };

/** Id baru diketahui saat permintaan datang, jadi dibaca di dalam batas Suspense. */
async function Approve({ params }: Props) {
  const { id } = await params;
  return <ThreadsPairApprove id={id} />;
}

export default function ThreadsPairApprovePage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <Approve params={params} />
    </Suspense>
  );
}
