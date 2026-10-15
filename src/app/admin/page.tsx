"use client";

import React, { Activity, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Package,
  Receipt,
  RotateCw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAdminPlans } from "@/lib/admin-client";
import type { AdminPlansResponse } from "@/lib/plan-types";
import { logout } from "@/components/layout/session-nav";
import { useMe } from "@/components/layout/use-me";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { AuditTab } from "@/components/admin/audit-tab";
import { BillingTab } from "@/components/admin/billing-tab";
import { IntegrationsTab } from "@/components/admin/integrations-tab";
import { OverviewTab } from "@/components/admin/overview-tab";
import { PlansTab } from "@/components/admin/plans-tab";
import { AdminContext, type AdminContextValue, type AdminTabKey } from "@/components/admin/shared";
import { SourcesTab } from "@/components/admin/sources-tab";
import { SystemTab } from "@/components/admin/system-tab";
import { UsersTab } from "@/components/admin/users-tab";
import { WorkspacesTab } from "@/components/admin/workspaces-tab";
import { errorStatus } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, Pill } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";

interface NavItem {
  key: AdminTabKey;
  label: string;
  subtitle: string;
  group: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const TABS: NavItem[] = [
  {
    key: "ringkasan",
    label: "Ringkasan & KPI",
    subtitle: "Metrik eksekutif SaaS (MRR, ARR, ARPU, Konversi, Retensi, SLA Autopilot) & kesehatan seluruh platform.",
    group: "Eksekutif & Monetisasi",
    Icon: BarChart3,
  },
  {
    key: "paket",
    label: "Paket & Harga",
    subtitle: "Atur daftar paket sewa, harga bulanan, kuota akun Threads, batas posting harian, dan paket bawaan.",
    group: "Eksekutif & Monetisasi",
    Icon: Package,
  },
  {
    key: "transaksi",
    label: "Transaksi & Tagihan",
    subtitle: "Pantau kas masuk, riwayat invoice pelanggan, verifikasi pembayaran manual, dan status webhook Payment Gateway.",
    group: "Eksekutif & Monetisasi",
    Icon: Receipt,
  },
  {
    key: "workspace",
    label: "Workspace Tenant",
    subtitle: "Kelola semua workspace pelanggan, pasang atau perpanjang masa aktif paket, atur anggota, dan penangguhan.",
    group: "Tenant & Operasional",
    Icon: Building2,
  },
  {
    key: "pengguna",
    label: "Pengguna & Peran",
    subtitle: "Kelola seluruh akun pengguna terdaftar, hak akses Super Admin, reset password, dan pemblokiran keamanan.",
    group: "Tenant & Operasional",
    Icon: Users,
  },
  {
    key: "sumber",
    label: "Sumber Akun Threads",
    subtitle: "Kelola penautan akun Threads dari sumber eksternal ke tenant workspace pelanggan.",
    group: "Tenant & Operasional",
    Icon: Link2,
  },
  {
    key: "integrasi",
    label: "Integrasi & API Keys",
    subtitle: "Kunci API Xendit (pembayaran), Google OAuth (masuk), dan Meta Threads (hubungkan akun).",
    group: "Konfigurasi Platform",
    Icon: KeyRound,
  },
  {
    key: "sistem",
    label: "Saklar Sistem",
    subtitle: "Kontrol pendaftaran mandiri, saklar darurat autopilot global, dan pengumuman siaran ke seluruh workspace.",
    group: "Konfigurasi Platform",
    Icon: SlidersHorizontal,
  },
  {
    key: "audit",
    label: "Log Audit Platform",
    subtitle: "Jejak audit permanen atas seluruh tindakan Super Admin, pembayaran, dan perubahan konfigurasi sistem.",
    group: "Konfigurasi Platform",
    Icon: ScrollText,
  },
];

const NO_REV: Record<AdminTabKey, number> = {
  ringkasan: 0,
  paket: 0,
  transaksi: 0,
  workspace: 0,
  pengguna: 0,
  sumber: 0,
  integrasi: 0,
  sistem: 0,
  audit: 0,
};

function ConsoleSkeleton() {
  return (
    <div className="flex min-h-screen w-full bg-bg" aria-busy="true" aria-label="Memuat konsol super admin">
      <aside className="hidden md:flex flex-col w-64 bg-surface border-r border-line p-4 space-y-4">
        <div className="h-10 w-40 rounded-xl bg-subtle animate-pulse" />
        <div className="space-y-2 pt-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-subtle animate-pulse" />
          ))}
        </div>
      </aside>
      <div className="flex-1 p-6 md:p-8 space-y-6">
        <div className="h-12 w-64 rounded-xl bg-subtle animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-pulse">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card p-4">
              <div className="h-3 w-16 rounded bg-subtle" />
              <div className="mt-2 h-6 w-20 rounded bg-subtle" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AdminInner() {
  const { me, loading, error, reload } = useMe();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const currentTabItem = TABS.find((t) => t.key === rawTab) ?? TABS[0];
  const tab: AdminTabKey = currentTabItem.key;
  const isSuper = me?.superadmin === true;

  const [rev, setRev] = useState(NO_REV);
  const [revoked, setRevoked] = useState(false);

  const reloadMe = useCallback(() => {
    void reload();
  }, [reload]);

  const guard = useCallback(
    <T,>(request: Promise<T>): Promise<T> =>
      request.catch((e: unknown) => {
        if (errorStatus(e) === 403) {
          setRevoked(true);
          void reload();
        }
        throw e;
      }),
    [reload]
  );

  const invalidate = useCallback(
    (tabs: AdminTabKey[]) =>
      setRev((prev) => {
        const next = { ...prev };
        for (const t of tabs) next[t] += 1;
        return next;
      }),
    []
  );

  const setTab = useCallback(
    (next: AdminTabKey) => {
      if (next === tab) return;
      const params = new URLSearchParams(searchParams.toString());
      if (next === "ringkasan") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [tab, searchParams, pathname]
  );

  const openTab = useCallback(
    (next: AdminTabKey) => {
      setTab(next);
      document.getElementById(`admin-tab-${next}`)?.focus();
    },
    [setTab]
  );

  const ctx = useMemo<AdminContextValue>(
    () => ({ guard, rev, invalidate, openTab, reloadMe }),
    [guard, rev, invalidate, openTab, reloadMe]
  );

  // Daftar paket dimuat saat Super Admin membuka konsol agar langsung tersedia di tab Paket dan tab Workspace.
  const plans = useRemote<AdminPlansResponse>(
    isSuper ? `paket:${rev.paket}` : null,
    (signal) => guard(fetchAdminPlans(signal)),
    "Gagal memuat daftar paket."
  );

  useEffect(() => {
    const el = document.getElementById(`admin-tab-${tab}`);
    const bar = el?.parentElement;
    if (!el || !bar) return;
    const item = el.getBoundingClientRect();
    const view = bar.getBoundingClientRect();
    if (item.left < view.left + 16) bar.scrollLeft += item.left - view.left - 16;
    else if (item.right > view.right - 16) bar.scrollLeft += item.right - view.right + 16;
  }, [tab, isSuper]);

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const at = TABS.findIndex((t) => t.key === tab);
    const next =
      e.key === "Home"
        ? TABS[0]
        : e.key === "End"
          ? TABS[TABS.length - 1]
          : TABS[(at + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    openTab(next.key);
  };

  if (loading) return <ConsoleSkeleton />;

  if (!me) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div role="alert" className="card max-w-md w-full p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{error ?? "Gagal memuat profil."}</p>
          <button type="button" onClick={reloadMe} className={cn(BTN_PRIMARY, "mt-4")}>
            <RotateCw className="w-4 h-4" />
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  // Hanya untuk role SUPERADMIN: halaman terpisah dan terlindungi penuh.
  if (!isSuper) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="card max-w-lg w-full p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-fg">Akses Ditolak — Khusus Super Admin</h2>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">
            {revoked
              ? "Peran Super Admin Anda sudah dicabut, sehingga Konsol Super Admin ini ditutup."
              : "Konsol ini terpisah dari dashboard pelanggan dan hanya dapat diakses oleh pengelola platform dengan peran SUPERADMIN."}
          </p>
          <Link href="/" className={cn(BTN_PRIMARY, "mt-5")}>
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Dashboard Workspace
          </Link>
        </div>
      </div>
    );
  }

  const groups = Array.from(new Set(TABS.map((t) => t.group)));
  const ActiveIcon = currentTabItem.Icon;

  return (
    <AdminContext.Provider value={ctx}>
      {/* Sidebar Khusus Konsol Super Admin (Terpisah dari Sidebar Pelanggan) */}
      <aside className="hidden md:flex flex-col w-64 bg-surface border-r border-line h-screen sticky top-0 shrink-0 z-30">
        <div className="h-16 flex items-center justify-between px-5 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <Image src="/logo.webp" alt="BotThreads" width={36} height={36} priority className="w-9 h-9 rounded-xl shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-fg truncate leading-tight">BotThreads</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-accent">Super Admin Console</p>
            </div>
          </div>
        </div>

        <nav aria-label="Menu konsol super admin" className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {groups.map((group) => (
            <div key={group} className="space-y-1">
              <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-faint">{group}</p>
              {TABS.filter((t) => t.group === group).map((item) => {
                const active = tab === item.key;
                const Icon = item.Icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium transition-colors cursor-pointer text-left",
                      active ? "bg-accent text-on-accent font-semibold" : "text-muted hover:text-fg hover:bg-subtle"
                    )}
                  >
                    <Icon className="w-[18px] h-[18px] shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-line space-y-2 bg-subtle/40">
          <div className="px-3 py-2 rounded-xl bg-surface border border-line flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-soft text-accent flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-fg truncate">{me.user.name || me.user.username}</p>
              <p className="text-[11px] text-muted truncate">@{me.user.username} · SUPERADMIN</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-line-strong bg-surface text-xs font-semibold text-fg hover:border-accent hover:text-accent transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Ke Workspace
            </Link>
            <button
              type="button"
              onClick={logout}
              title="Keluar"
              aria-label="Keluar dari sesi"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line-strong bg-surface text-danger hover:bg-danger-soft transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Area Utama Konsol Super Admin */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Bar Khusus Super Admin */}
        <header className="h-16 bg-surface border-b border-line px-4 md:px-8 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <Image src="/logo.webp" alt="BotThreads" width={32} height={32} className="md:hidden w-8 h-8 rounded-lg shrink-0" />
            <div className="min-w-0 flex items-center gap-2.5">
              <h1 className="text-base sm:text-lg font-bold text-fg truncate">{currentTabItem.label}</h1>
              <Pill tone="solid" icon={<ShieldCheck className="w-3.5 h-3.5 shrink-0" />} className="hidden sm:inline-flex">
                Super Admin
              </Pill>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link href="/" className={cn(BTN_OUTLINE, "h-9 px-3 text-xs")}>
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dashboard Workspace</span>
              <span className="sm:hidden">Workspace</span>
            </Link>
            <ThemeToggle />
          </div>
        </header>

        {/* Bilah Navigasi Horizontal (Selalu tampil di mobile, juga memudahkan pindah tab cepat) */}
        <div
          role="tablist"
          aria-label="Modul konsol super admin"
          onKeyDown={onTabKey}
          className="md:hidden px-4 bg-surface border-b border-line flex gap-5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`admin-tab-${t.key}`}
                aria-selected={active}
                aria-controls={`admin-panel-${t.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.key)}
                className={cn(
                  "relative shrink-0 h-11 inline-flex items-center text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                  active ? "text-accent" : "text-muted hover:text-fg"
                )}
              >
                {t.label}
                {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
              </button>
            );
          })}
        </div>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-[1380px] w-full mx-auto space-y-6">
          {/* Header Bagian Aktif */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <ActiveIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-fg leading-tight">{currentTabItem.label}</h2>
                <p className="text-sm text-muted">{currentTabItem.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Panel Modul Super Admin */}
          <div>
            <Activity mode={tab === "ringkasan" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-ringkasan" aria-labelledby="admin-tab-ringkasan">
                <OverviewTab />
              </div>
            </Activity>
            <Activity mode={tab === "paket" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-paket" aria-labelledby="admin-tab-paket">
                <PlansTab plans={plans} />
              </div>
            </Activity>
            <Activity mode={tab === "transaksi" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-transaksi" aria-labelledby="admin-tab-transaksi">
                <BillingTab />
              </div>
            </Activity>
            <Activity mode={tab === "workspace" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-workspace" aria-labelledby="admin-tab-workspace">
                <WorkspacesTab plans={plans} />
              </div>
            </Activity>
            <Activity mode={tab === "pengguna" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-pengguna" aria-labelledby="admin-tab-pengguna">
                <UsersTab />
              </div>
            </Activity>
            <Activity mode={tab === "sumber" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-sumber" aria-labelledby="admin-tab-sumber">
                <SourcesTab />
              </div>
            </Activity>
            <Activity mode={tab === "integrasi" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-integrasi" aria-labelledby="admin-tab-integrasi">
                <IntegrationsTab />
              </div>
            </Activity>
            <Activity mode={tab === "sistem" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-sistem" aria-labelledby="admin-tab-sistem">
                <SystemTab />
              </div>
            </Activity>
            <Activity mode={tab === "audit" ? "visible" : "hidden"}>
              <div role="tabpanel" id="admin-panel-audit" aria-labelledby="admin-tab-audit">
                <AuditTab />
              </div>
            </Activity>
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<ConsoleSkeleton />}>
      <AdminInner />
    </Suspense>
  );
}
