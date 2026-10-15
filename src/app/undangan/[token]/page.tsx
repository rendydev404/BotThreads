import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteForm } from "@/components/auth/invite-form";

export const metadata: Metadata = {
  title: "Undangan | BotThreads",
  robots: { index: false, follow: false },
  // Token ada di alamat halaman: jangan pernah ikut terkirim sebagai Referer.
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

/** Token baru diketahui saat permintaan datang, jadi dibaca di dalam batas Suspense. */
async function Invite({ params }: Props) {
  const { token } = await params;
  return <InviteForm token={token} />;
}

export default function InvitePage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <Invite params={params} />
    </Suspense>
  );
}
