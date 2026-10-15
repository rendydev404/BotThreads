import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = {
  title: "Reset password | BotThreads",
  robots: { index: false, follow: false },
  // Token ada di alamat halaman: jangan pernah ikut terkirim sebagai Referer.
  referrer: "no-referrer",
};

type Props = { params: Promise<{ token: string }> };

/** Token baru diketahui saat permintaan datang, jadi dibaca di dalam batas Suspense. */
async function Reset({ params }: Props) {
  const { token } = await params;
  return <ResetForm token={token} />;
}

export default function ResetPasswordPage({ params }: Props) {
  return (
    <Suspense fallback={null}>
      <Reset params={params} />
    </Suspense>
  );
}
