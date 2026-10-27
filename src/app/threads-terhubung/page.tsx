import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AuthFrame, AuthNotice } from "@/components/auth/auth-frame";
import { getT } from "@/lib/i18n/server";

/** Judul tab mengikuti bahasa (cookie `lang`); halaman ini sudah punya bagian dinamis, jadi aman dibaca saat permintaan. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Hubungkan Threads")} | BotThreads`, robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<{ threads_connected?: string; threads_error?: string }> };

/**
 * Hasil hubungkan akun Threads bila login selesai di browser tanpa sesi dashboard (mis. halaman izin terbuka di
 * aplikasi Threads atau browser lain di HP). Akun sudah tersimpan di workspace; pengguna cukup kembali ke dashboard.
 */
async function Result({ searchParams }: Props) {
  const [sp, t] = await Promise.all([searchParams, getT()]);
  const username = sp.threads_connected?.slice(0, 60);
  if (username) {
    return (
      <AuthNotice
        tone="success"
        icon={<CheckCircle2 className="w-6 h-6" />}
        title={t("@{username} terhubung", { username })}
        href="/akun"
        action={t("Buka dashboard")}
      >
        {t("Akun Threads sudah tersimpan di workspace Anda. Kembali ke aplikasi atau browser tempat Anda membuka BotThreads, lalu muat ulang halaman Akun Threads.")}
      </AuthNotice>
    );
  }
  return (
    <AuthNotice
      tone="danger"
      icon={<AlertTriangle className="w-6 h-6" />}
      title={t("Akun Threads belum terhubung")}
      href="/akun"
      action={t("Coba lagi dari dashboard")}
    >
      {t(sp.threads_error?.slice(0, 200) || "Login Threads tidak selesai. Silakan ulangi.")}
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
