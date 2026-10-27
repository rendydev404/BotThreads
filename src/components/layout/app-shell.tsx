"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertOctagon, Ban, CreditCard, Link2, LogOut, Megaphone, ShieldAlert, Sparkles } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { TourLauncher } from "@/components/tour/tour-launcher";
import { logout } from "./session-nav";
import { useMe } from "./use-me";
import { PageGuide } from "./page-guide";
import { FloatingAiBubble } from "@/components/chat/floating-ai-bubble";
import { formatDateWib } from "@/components/settings/format";
import { ThreadsConnectButton } from "@/components/settings/threads-connect-button";
import { useT } from "@/components/i18n/lang-provider";

/** Halaman tanpa sesi (login, terima undangan, reset password, kebijakan legal) tampil polos: tanpa sidebar/header/bubble. */
const BARE_PREFIXES = ["/undangan/", "/reset-password/"];
const BARE_PAGES = [
  "/login",
  "/daftar",
  "/selamat-datang",
  "/kebijakan-privasi",
  "/syarat-ketentuan",
  "/kebijakan-pengembalian",
  "/pengiriman-layanan",
  "/penghapusan-data",
  "/kontak",
  "/threads-terhubung",
];
const isBare = (pathname: string): boolean => BARE_PAGES.includes(pathname) || BARE_PREFIXES.some((p) => pathname.startsWith(p));

/** Pengguna masuk tetapi belum menjadi anggota workspace mana pun: tidak ada data yang boleh dimuat. */
function NoAccess() {
  const t = useT();
  return (
    <div className="card max-w-lg mx-auto mt-10 p-6 text-center">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-fg">{t("Belum ada akses workspace")}</h2>
      <p className="mt-1.5 text-sm text-muted leading-relaxed">
        {t("Akun Anda aktif, tetapi belum terhubung ke workspace mana pun. Hubungi kami lewat halaman Kontak bila ini keliru.")}
      </p>
      <button
        type="button"
        onClick={logout}
        className="mt-5 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-line text-sm font-semibold text-fg hover:bg-subtle transition-colors cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
        {t("Keluar")}
      </button>
    </div>
  );
}

/** Workspace aktif ditangguhkan pengelola platform: datanya tidak bisa dibuka sampai dipulihkan. */
function Suspended({ reason, canSwitch }: { reason: string | null; canSwitch: boolean }) {
  const t = useT();
  return (
    <div className="card max-w-lg mx-auto mt-10 p-6 text-center" role="alert">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-danger-soft text-danger flex items-center justify-center">
        <Ban className="w-6 h-6" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-fg">{t("Workspace ini ditangguhkan")}</h2>
      <p className="mt-1.5 text-sm text-muted leading-relaxed">
        {t("Pengelola platform menangguhkan workspace ini, jadi datanya tidak bisa dibuka dan autopilotnya berhenti.")}
        {reason ? <span className="block mt-2 font-medium text-fg">{t("Alasan:")} {reason}</span> : null}
      </p>
      <p className="mt-3 text-[13px] text-muted">
        {canSwitch ? t("Anda masih bisa pindah ke workspace lain lewat menu akun di pojok kanan atas.") : t("Hubungi pengelola platform bila ini keliru.")}
      </p>
      <button
        type="button"
        onClick={logout}
        className="mt-5 inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-line text-sm font-semibold text-fg hover:bg-subtle transition-colors cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
        {t("Keluar")}
      </button>
    </div>
  );
}

/** Paket workspace habis masa berlaku: autopilot berhenti dan akun baru tidak bisa ditambah sampai diperpanjang. */
function PlanExpiredBanner({ nama, berakhir, canRenew }: { nama: string | null; berakhir: string | null; canRenew: boolean }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border-2 border-danger bg-danger-soft p-5 sm:p-6"
    >
      <div className="flex items-start gap-4 min-w-0">
        <div className="w-12 h-12 rounded-2xl bg-danger text-white flex items-center justify-center shrink-0">
          <AlertOctagon className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-danger leading-tight">
            {t("Paket {nama} Anda sudah habis", { nama: nama ?? t("langganan") })}
            {berakhir ? <span className="font-semibold"> {t("sejak {tanggal}", { tanggal: formatDateWib(berakhir) })}</span> : null}
          </h2>
          <p className="mt-1.5 text-sm text-fg leading-relaxed">
            {t("Autopilot semua akun dihentikan dan akun Threads baru tidak bisa ditambahkan.")}{" "}
            {canRenew
              ? t("Perpanjang paket supaya semuanya berjalan lagi.")
              : t("Minta Pemilik atau Admin workspace memperpanjang paket.")}
          </p>
        </div>
      </div>
      {canRenew && (
        <Link
          href="/billing"
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-danger text-white text-sm font-bold whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
        >
          <Sparkles className="w-4 h-4" />
          {t("Perpanjang Paket Sekarang")}
        </Link>
      )}
    </div>
  );
}

function Frame({ children, pathname }: { children: React.ReactNode; pathname: string }) {
  const t = useT();
  const { me } = useMe();
  // Konsol super admin memiliki tata letak terpisah sendiri dan hanya dapat diakses oleh SUPERADMIN.
  const adminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  if (adminPage) {
    return <div className="flex min-h-screen w-full bg-bg text-fg">{children}</div>;
  }

  const blocked = me?.hasAccess === false;

  return (
    <>
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Header />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-[1280px] w-full mx-auto pb-28 md:pb-12">
          {me?.announcement && (
            <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-sm text-fg">
              <Megaphone className="w-[18px] h-[18px] mt-0.5 text-accent shrink-0" />
              <p className="leading-relaxed break-words min-w-0">{me.announcement}</p>
            </div>
          )}
          {!blocked && me?.planExpired && (
            <PlanExpiredBanner
              nama={me.planExpired.nama}
              berakhir={me.planExpired.berakhir}
              canRenew={me.role === "OWNER" || me.role === "ADMIN"}
            />
          )}
          {/* Workspace baru belum punya akun Threads: arahkan ke penghubungan akun mandiri & pilihan paket sewa. */}
          {!blocked && me?.accountCount === 0 && (
            <div role="status" className="mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-accent-soft text-fg p-4 text-sm">
              <div className="flex items-start gap-3 min-w-0">
                <Link2 className="w-[18px] h-[18px] mt-0.5 text-accent shrink-0" />
                <p className="leading-relaxed">
                  <span className="font-semibold">{t("Belum ada akun Threads yang terhubung ke workspace ini.")}</span>{" "}
                  {t("Hubungkan akun Threads Anda secara mandiri untuk mengaktifkan analitik, penjadwalan, dan autopilot AI.")}
                </p>
              </div>
              {/* Menghubungkan akun hanya untuk Pemilik/Admin (sama dengan /api/threads/oauth); peran lain diberi arahan. */}
              {me.role === "OWNER" || me.role === "ADMIN" ? (
              <div className="flex flex-wrap items-center gap-2 shrink-0 sm:ml-2">
                <ThreadsConnectButton size="sm" />
                <Link
                  href="/billing"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface border border-line-strong text-fg text-xs font-semibold hover:border-accent hover:text-accent transition-colors"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  {t("Pilih Paket Sewa")}
                </Link>
              </div>
              ) : (
                <p className="text-xs text-muted shrink-0 sm:ml-2">{t("Minta Pemilik atau Admin workspace menghubungkannya.")}</p>
              )}
            </div>
          )}
          {!blocked && me && <PageGuide pathname={pathname} />}
          {blocked ? me?.suspended ? <Suspended reason={me.suspended.reason} canSwitch={me.workspaces.length > 1} /> : <NoAccess /> : children}
        </main>
      </div>
      <BottomNav />
      {!blocked && <FloatingAiBubble />}
      {!blocked && <TourLauncher />}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isBare(pathname)) return <>{children}</>;

  return <Frame pathname={pathname}>{children}</Frame>;
}
