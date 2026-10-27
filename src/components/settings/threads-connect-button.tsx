"use client";

import React, { useSyncExternalStore } from "react";
import { Monitor, Settings, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThreadsMark } from "@/components/landing/threads-mark";
import { useT } from "@/components/i18n/lang-provider";

/**
 * Tombol "hubungkan akun Threads" bergaya merek Threads: logo Threads, hitam di tema terang dan putih di
 * tema gelap (warna resmi Threads), supaya pengguna langsung tahu tombol ini membawanya ke Threads.
 * Satu-satunya pintu masuk OAuth: /api/threads/oauth (Pemilik/Admin).
 */
const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-colors bg-black text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-neutral-400/40";
const SIZE = {
  sm: "h-9 px-3.5 rounded-lg text-xs",
  md: "h-10 px-5 rounded-full text-sm",
} as const;

export function ThreadsConnectButton({
  label = "Hubungkan Akun Threads",
  size = "md",
  disabled,
  disabledTitle,
  reconnect,
  className,
}: {
  label?: string;
  /** Hubungkan ulang akun yang sudah ada: tetap bisa dipakai walau kuota akun paket penuh. */
  reconnect?: boolean;
  size?: keyof typeof SIZE;
  /** Belum bisa dipakai (mis. fitur belum diaktifkan pengelola): tampil redup, tidak bisa diklik. */
  disabled?: boolean;
  disabledTitle?: string;
  className?: string;
}) {
  // Label boleh berupa teks sumber (ID) atau sudah diterjemahkan pemanggil: t() pada teks EN tetap mengembalikannya apa adanya.
  const t = useT();
  const icon = <ThreadsMark className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />;
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledTitle ? t(disabledTitle) : disabledTitle}
        className={cn(BASE, SIZE[size], "opacity-50 cursor-not-allowed", className)}
      >
        {icon}
        {t(label)}
      </button>
    );
  }
  return (
    <a href={reconnect ? "/api/threads/oauth?reconnect=1" : "/api/threads/oauth"} className={cn(BASE, SIZE[size], className)}>
      {icon}
      {t(label)}
    </a>
  );
}

const noop = () => () => {};
const isAndroid = () => /Android/i.test(navigator.userAgent);

/**
 * Panduan khusus Android. Bila aplikasi Threads terpasang, halaman login/izin Threads milik Meta sendiri mengalihkan
 * ke aplikasi (manifest web Threads mendaftarkan com.instagram.barcelona), bahkan untuk link yang ditempel manual,
 * dan dialog izin tidak pernah muncul. Dua jalan yang pasti: hubungkan dari komputer, atau matikan "Buka link yang
 * didukung" untuk aplikasi Threads. Di luar Android tidak ditampilkan.
 */
export function ThreadsAndroidHelp({ className }: { className?: string }) {
  const t = useT();
  const android = useSyncExternalStore(noop, isAndroid, () => false);
  const dashboardUrl = useSyncExternalStore(noop, () => `${window.location.host}/akun`, () => "");
  if (!android) return null;

  return (
    <div className={cn("rounded-xl border border-line bg-subtle p-4 text-left text-[13px] text-muted leading-relaxed", className)}>
      <p className="font-semibold text-fg text-sm flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-accent shrink-0" />
        {t("Pakai HP Android? Aplikasi Threads bisa terbuka sendiri")}
      </p>
      <p className="mt-1">
        {t(
          "Bila aplikasi Threads terpasang, halaman login Threads (milik Meta) langsung pindah ke aplikasi sehingga dialog izin tidak muncul. Pilih salah satu cara ini:"
        )}
      </p>

      <div className="mt-3 rounded-lg bg-surface border border-line p-3">
        <p className="font-semibold text-fg flex items-center gap-2">
          <Monitor className="w-4 h-4 shrink-0" />
          {t("Cara 1 (paling mudah): lewat komputer")}
        </p>
        <ol className="mt-1.5 list-decimal pl-5 space-y-0.5">
          <li>
            {t("Buka")} <b className="text-fg break-all">{dashboardUrl}</b>{" "}
            {t("di browser komputer, masuk dengan akun dashboard yang sama.")}
          </li>
          <li>
            {t("Klik")} <b>{t("Hubungkan Akun Threads")}</b>
            {t(", masuk ke Threads, lalu tekan")} <b>{t("Izinkan")}</b>.
          </li>
          <li>{t("Selesai. Akun langsung bisa dipakai juga dari HP ini.")}</li>
        </ol>
      </div>

      <div className="mt-2.5 rounded-lg bg-surface border border-line p-3">
        <p className="font-semibold text-fg flex items-center gap-2">
          <Settings className="w-4 h-4 shrink-0" />
          {t("Cara 2: tetap dari HP ini")}
        </p>
        <ol className="mt-1.5 list-decimal pl-5 space-y-0.5">
          <li>
            {t("Buka")} <b>{t("Setelan HP > Aplikasi > Threads")}</b>.
          </li>
          <li>
            {t("Ketuk")} <b>{t("Buka secara default")}</b> {t("(di Samsung:")} <b>{t("Tetapkan sebagai default")}</b>
            {t("), lalu matikan")} <b>{t("Buka link yang didukung")}</b>.
          </li>
          <li>
            {t("Kembali ke sini, ketuk")} <b>{t("Hubungkan Akun Threads")}</b>
            {t(", masuk dengan username dan password Threads, lalu tekan")} <b>{t("Izinkan")}</b>.
          </li>
          <li>{t("Setelah terhubung, setelan tadi boleh dinyalakan lagi.")}</li>
        </ol>
      </div>
    </div>
  );
}

