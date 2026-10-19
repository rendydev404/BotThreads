"use client";

import React, { Activity, Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, RotateCw, Settings, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTeam, type Role, type TeamResponse } from "@/lib/team-client";
import { roleAtLeast, useMe } from "@/components/layout/use-me";
import { Banner } from "@/components/autopilot/shared";
import { AuditTab } from "@/components/settings/audit-tab";
import { BrandTab } from "@/components/settings/brand-tab";
import { HealthTab } from "@/components/settings/health-tab";
import { KnowledgeTab } from "@/components/settings/knowledge-tab";
import { PlanCard } from "@/components/settings/plan-card";
import { BTN_PRIMARY, Pill } from "@/components/settings/states";
import { SubscriptionTab } from "@/components/settings/subscription-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { useRemote } from "@/components/settings/use-remote";

type TabKey = "brand" | "langganan" | "pengetahuan" | "tim" | "audit" | "kesehatan";

/**
 * Peran minimal tiap tab mengikuti route API-nya: tim dan audit hanya untuk Admin ke atas; brand,
 * pengetahuan, langganan, dan hasil belajar bisa dibaca semua peran (tombol ubah diatur di dalam tab).
 * Akun Threads punya halaman sendiri (/akun); ?tab=akun dari tautan lama dialihkan ke sana.
 */
const TABS: { key: TabKey; label: string; min: Role }[] = [
  { key: "brand", label: "Brand", min: "VIEWER" },
  { key: "langganan", label: "Langganan & Tagihan", min: "VIEWER" },
  { key: "pengetahuan", label: "Pengetahuan", min: "VIEWER" },
  { key: "tim", label: "Tim", min: "ADMIN" },
  { key: "audit", label: "Audit", min: "ADMIN" },
  { key: "kesehatan", label: "Kesehatan", min: "VIEWER" },
];

function PageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-11 h-11 rounded-2xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
          <Settings className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-fg leading-tight">Pengaturan</h2>
          <p className="text-sm text-muted">Brand, akun Threads, paket sewa & tagihan, pengetahuan AI, tim, dan kesehatan autopilot.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Memuat pengaturan">
      <PageHeader />
      <div className="flex gap-6 border-b border-line animate-pulse">
        {[12, 20, 10, 12].map((w, i) => (
          <div key={i} className="h-11 flex items-center">
            <div className="h-3.5 rounded bg-subtle" style={{ width: `${w * 4}px` }} />
          </div>
        ))}
      </div>
      <div className="card p-4 sm:p-6 space-y-5 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-3.5 w-28 rounded bg-subtle" />
            <div className="mt-2 h-11 rounded-xl bg-subtle" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsInner() {
  const { me, loading, error, role, canEdit, isAdmin, reload } = useMe();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const router = useRouter();

  // Tautan lama ke tab Akun Threads (mis. hasil login Threads): pindah ke halaman /akun, bawa parameter lain.
  useEffect(() => {
    if (rawTab !== "akun") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `/akun?${qs}` : "/akun");
  }, [rawTab, searchParams, router]);

  // Tab yang tidak boleh dipakai peran ini disembunyikan; ?tab= yang mengarah ke sana jatuh ke Brand.
  const tabs = TABS.filter((t) => roleAtLeast(role, t.min));
  const tab: TabKey = tabs.find((t) => t.key === rawTab)?.key ?? "brand";
  const denied = TABS.find((t) => t.key === rawTab && !roleAtLeast(role, t.min));

  // Data tim dipakai dua tab: Tim, dan Audit (nama anggota yang menjadi sasaran tindakan). Dimuat saat
  // tab Tim dibuka, atau saat halaman audit memang memuat tindakan terhadap anggota.
  const [auditNeedsTeam, setAuditNeedsTeam] = useState(false);
  const needTeam = useCallback(() => setAuditNeedsTeam(true), []);
  const team = useRemote<TeamResponse>(
    isAdmin && (tab === "tim" || (tab === "audit" && auditNeedsTeam)) ? "tim" : null,
    fetchTeam,
    "Gagal memuat tim."
  );

  // Bilah tab bisa digulir mendatar di ponsel: pastikan tab aktif terlihat (mis. dibuka lewat ?tab=kesehatan).
  // Hanya bilahnya yang digeser, supaya posisi gulir halaman tidak ikut berubah.
  useEffect(() => {
    const el = document.getElementById(`pengaturan-tab-${tab}`);
    const bar = el?.parentElement;
    if (!el || !bar) return;
    const item = el.getBoundingClientRect();
    const view = bar.getBoundingClientRect();
    if (item.left < view.left + 16) bar.scrollLeft += item.left - view.left - 16;
    else if (item.right > view.right - 16) bar.scrollLeft += item.right - view.right + 16;
  }, [tab]);

  // Tab aktif disimpan di URL (?tab=) lewat History API: tanpa navigasi ulang ke server.
  const setTab = (next: TabKey) => {
    if (next === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "brand") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const at = tabs.findIndex((t) => t.key === tab);
    const next =
      e.key === "Home"
        ? tabs[0]
        : e.key === "End"
          ? tabs[tabs.length - 1]
          : tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.key);
    document.getElementById(`pengaturan-tab-${next.key}`)?.focus();
  };

  if (loading) return <PageSkeleton />;

  if (!me) {
    return (
      <div className="space-y-5">
        <PageHeader />
        <div role="alert" className="card p-8 text-center">
          <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
          <p className="mt-3 text-sm font-semibold text-fg">{error ?? "Gagal memuat profil."}</p>
          <button type="button" onClick={() => void reload()} className={cn(BTN_PRIMARY, "mt-4")}>
            <RotateCw className="w-4 h-4" />
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (!me.hasAccess) {
    return (
      <div className="space-y-5">
        <PageHeader />
        <div className="card p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-warning-soft text-warning flex items-center justify-center">
            <UserX className="w-6 h-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-fg">Anda belum menjadi anggota workspace mana pun.</h3>
          <p className="mt-1 text-sm text-muted max-w-md mx-auto">
            Minta Admin atau Pemilik workspace mengirim tautan undangan, lalu buka halaman ini lagi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader>
        <p className="shrink-0 inline-flex items-center gap-2 text-[13px] text-muted">
          Peran Anda
          <Pill tone="accent">{me.roleLabel}</Pill>
        </p>
      </PageHeader>

      {/* Banner keadaan */}
      {!me.multiUser && (
        <Banner tone="warning">
          Fitur tim belum dipasang di database (sql/008_multiuser.sql). Sampai dipasang, setiap pengguna diperlakukan sebagai Pemilik
          dan bagian Brand, Tim, serta Audit belum bisa dipakai.
        </Banner>
      )}
      {denied && (
        <Banner tone="info">
          Bagian {denied.label} hanya bisa dibuka Admin atau Pemilik. Anda masuk sebagai {me.roleLabel}.
        </Banner>
      )}

      {/* Tab: bilahnya digulir mendatar bila tidak muat (ponsel). */}
      <PlanCard
        onOpenSubscription={tab !== "langganan" ? () => setTab("langganan") : undefined}
        onOpenAccounts={() => router.push("/akun")}
      />

      <div
        role="tablist"
        aria-label="Bagian pengaturan"
        onKeyDown={onTabKey}
        className="-mx-4 px-4 md:mx-0 md:px-0 flex gap-6 border-b border-line overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`pengaturan-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`pengaturan-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={cn(
                "relative shrink-0 h-11 inline-flex items-center text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer rounded-md focus-visible:outline-offset-[-2px]",
                active ? "text-accent" : "text-muted hover:text-fg"
              )}
            >
              {t.label}
              {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      {/* Panel tetap terpasang (isian tidak hilang saat pindah tab); efek, termasuk fetch, hanya jalan saat terlihat. */}
      <div>
        <Activity mode={tab === "brand" ? "visible" : "hidden"}>
          <div role="tabpanel" id="pengaturan-panel-brand" aria-labelledby="pengaturan-tab-brand">
            <BrandTab />
          </div>
        </Activity>
        <Activity mode={tab === "langganan" ? "visible" : "hidden"}>
          <div role="tabpanel" id="pengaturan-panel-langganan" aria-labelledby="pengaturan-tab-langganan">
            <SubscriptionTab canManage={isAdmin} />
          </div>
        </Activity>
        <Activity mode={tab === "pengetahuan" ? "visible" : "hidden"}>
          <div role="tabpanel" id="pengaturan-panel-pengetahuan" aria-labelledby="pengaturan-tab-pengetahuan">
            <KnowledgeTab canEdit={canEdit} accountScoped={me.accountScoped} />
          </div>
        </Activity>
        {isAdmin && (
          <>
            <Activity mode={tab === "tim" ? "visible" : "hidden"}>
              <div role="tabpanel" id="pengaturan-panel-tim" aria-labelledby="pengaturan-tab-tim">
                <TeamTab team={team} onSelfChanged={() => void reload()} />
              </div>
            </Activity>
            <Activity mode={tab === "audit" ? "visible" : "hidden"}>
              <div role="tabpanel" id="pengaturan-panel-audit" aria-labelledby="pengaturan-tab-audit">
                <AuditTab members={team.data?.members ?? null} onNeedMembers={needTeam} />
              </div>
            </Activity>
          </>
        )}
        <Activity mode={tab === "kesehatan" ? "visible" : "hidden"}>
          <div role="tabpanel" id="pengaturan-panel-kesehatan" aria-labelledby="pengaturan-tab-kesehatan">
            <HealthTab isAdmin={isAdmin} />
          </div>
        </Activity>
      </div>
    </div>
  );
}

export default function PengaturanPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsInner />
    </Suspense>
  );
}
