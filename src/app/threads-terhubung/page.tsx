import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AuthFrame, AuthNotice } from "@/components/auth/auth-frame";

export const metadata: Metadata = {
  title: "Hubungkan Threads | BotThreads",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ threads_connected?: string; threads_error?: string }> };

/**
 * Hasil hubungkan akun Threads bila login selesai di browser tanpa sesi dashboard (mis. halaman izin terbuka di
 * aplikasi Threads atau browser lain di HP). Akun sudah tersimpan di workspace; pengguna cukup kembali ke dashboard.
 */
async function Result({ searchParams }: Props) {
  const sp = await searchParams;
  const username = sp.threads_connected?.slice(0, 60);
  if (username) {
    return (
      <AuthNotice
        tone="success"
        icon={<CheckCircle2 className="w-6 h-6" />}
        title={`@${username} terhubung`}
        href="/pengaturan?tab=akun"
        action="Buka dashboard"
      >
        Akun Threads sudah tersimpan di workspace Anda. Kembali ke aplikasi atau browser tempat Anda membuka BotThreads, lalu muat ulang
        halaman Akun Threads.
      </AuthNotice>
    );
  }
  return (
    <AuthNotice
      tone="danger"
      icon={<AlertTriangle className="w-6 h-6" />}
      title="Akun Threads belum terhubung"
      href="/pengaturan?tab=akun"
      action="Coba lagi dari dashboard"
    >
      {sp.threads_error?.slice(0, 200) || "Login Threads tidak selesai. Silakan ulangi."}
    </AuthNotice>
  );
}

export default function ThreadsConnectedPage({ searchParams }: Props) {
  return (
    <AuthFrame title="Hubungkan akun Threads">
      <Suspense fallback={null}>
        <Result searchParams={searchParams} />
      </Suspense>
    </AuthFrame>
  );
}
