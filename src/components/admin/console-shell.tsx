"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronRight, CornerDownLeft, Lock, LogOut, Menu, RotateCw, Search, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAdminPlans } from "@/lib/admin-client";
import { hasPerm, type AdminPerm } from "@/lib/admin-perms";
import type { AdminPlansResponse } from "@/lib/plan-types";
import { logout } from "@/components/layout/session-nav";
import { useMe } from "@/components/layout/use-me";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { errorStatus } from "@/components/settings/format";
import { BTN_OUTLINE, BTN_PRIMARY, ICON_BTN } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { ADMIN_GROUPS, ADMIN_MODULES, moduleForPath, type AdminModuleDef } from "./nav";
import { AdminContext, useAdmin, type AdminContextValue, type AdminTabKey } from "./shared";

const NO_REV = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, 0])) as Record<AdminTabKey, number>;

/* ------------------------------------------------------------------ kerangka */

function ConsoleSkeleton() {
  return (
    <div className="flex min-h-screen w-full bg-canvas" aria-busy="true" aria-label="Memuat konsol admin">
      <aside className="hidden lg:flex flex-col w-64 bg-surface border-r border-line p-4 gap-4">
        <div className="h-10 w-40 rounded-xl bg-subtle animate-pulse" />
        <div className="space-y-2 pt-4">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-9 rounded-lg bg-subtle animate-pulse" />
          ))}
        </div>
      </aside>
      <div className="flex-1 p-6 lg:p-10 space-y-6">
        <div className="h-8 w-56 rounded-lg bg-subtle animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-surface border border-line animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-screen flex items-center justify-center p-6 bg-canvas">
      <div className="card max-w-md w-full p-8 text-center">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ navigasi */

function BrandMark() {
  return (
    <Link href="/admin" className="flex items-center gap-3 min-w-0">
      <Image src="/logo.webp" alt="" width={36} height={36} priority className="w-9 h-9 rounded-xl shrink-0" />
      <span className="min-w-0">
        <span className="block text-sm font-extrabold text-fg leading-tight truncate">BotThreads</span>
        <span className="block text-[11px] font-semibold text-muted leading-tight">Konsol Admin</span>
      </span>
    </Link>
  );
}

function NavList({ modules, active, onNavigate }: { modules: AdminModuleDef[]; active: AdminTabKey | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Menu konsol admin" className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
      {ADMIN_GROUPS.map((group) => {
        const items = modules.filter((m) => m.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</p>
            <ul className="space-y-0.5">
              {items.map((m) => {
                const on = m.key === active;
                return (
                  <li key={m.key}>
                    <Link
                      href={m.href}
                      onClick={onNavigate}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-3 h-9 rounded-lg text-[13.5px] transition-colors",
                        on ? "bg-accent-soft text-accent font-semibold" : "text-muted font-medium hover:text-fg hover:bg-subtle"
                      )}
                    >
                      <m.Icon className="w-[17px] h-[17px] shrink-0" />
                      <span className="truncate">{m.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function ProfileFooter({ name, username, roleNama }: { name: string; username: string; roleNama: string }) {
  return (
    <div className="p-3 border-t border-line space-y-2">
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <div className="w-8 h-8 rounded-full bg-accent-soft text-accent text-xs font-bold flex items-center justify-center shrink-0 uppercase">
          {(name || username).slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-fg truncate">{name || username}</p>
          <p className="text-[11px] text-muted truncate">{roleNama}</p>
        </div>
        <button type="button" onClick={logout} aria-label="Keluar" title="Keluar" className={cn(ICON_BTN, "w-8 h-8 hover:text-danger hover:bg-danger-soft")}>
          <LogOut className="w-4 h-4" />
        </button>
      </div>
      <Link
        href="/"
        className="flex items-center justify-center gap-1.5 h-9 rounded-lg border border-line text-xs font-semibold text-muted hover:text-fg hover:border-line-strong transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Kembali ke Dashboard Workspace
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ pencarian cepat */

function CommandPalette({ modules, onClose }: { modules: AdminModuleDef[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return modules;
    return modules.filter((m) => `${m.label} ${m.group} ${m.keywords} ${m.subtitle}`.toLowerCase().includes(term));
  }, [q, modules]);
  const current = Math.min(at, Math.max(results.length - 1, 0));

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const go = (m: AdminModuleDef | undefined) => {
    if (!m) return;
    onClose();
    router.push(m.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]" role="presentation">
      <button type="button" aria-label="Tutup pencarian" onClick={onClose} className="absolute inset-0 bg-fg/30 backdrop-blur-[2px] cursor-default" />
      <div role="dialog" aria-modal="true" aria-label="Pencarian cepat" className="relative w-full max-w-lg bg-surface border border-line rounded-2xl shadow-pop overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search className="w-4 h-4 text-faint shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((current + 1) % Math.max(results.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((current - 1 + results.length) % Math.max(results.length, 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(results[current]);
              }
            }}
            placeholder="Cari menu: pengguna, tagihan, audit..."
            aria-label="Cari menu konsol"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[current] ? `${listId}-${results[current].key}` : undefined}
            className="flex-1 h-14 bg-transparent text-[15px] text-fg placeholder:text-faint outline-none"
          />
          <kbd className="hidden sm:inline-flex h-6 px-1.5 items-center rounded-md border border-line text-[11px] font-semibold text-muted">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Tidak ada menu yang cocok.</li>}
          {results.map((m, i) => (
            <li
              key={m.key}
              id={`${listId}-${m.key}`}
              role="option"
              aria-selected={i === current}
              onMouseEnter={() => setAt(i)}
              onClick={() => go(m)}
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer", i === current ? "bg-accent-soft" : "hover:bg-subtle")}
            >
              <span className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", i === current ? "bg-surface text-accent" : "bg-subtle text-muted")}>
                <m.Icon className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-fg">{m.label}</span>
                <span className="block text-xs text-muted truncate">{m.subtitle}</span>
              </span>
              {i === current && <CornerDownLeft className="w-4 h-4 text-accent shrink-0" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ konsol */

export function AdminConsole({ children }: { children: React.ReactNode }) {
  const { me, loading, error, reload } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const [rev, setRev] = useState(NO_REV);
  // Pernah tampil sebagai staf di sesi ini: bila kemudian bukan staf lagi, perannya dicabut.
  const [wasStaff, setWasStaff] = useState(false);
  if (me?.superadmin && !wasStaff) setWasStaff(true);
  const revoked = wasStaff && me?.superadmin === false;
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);

  const izin = useMemo(() => me?.admin?.izin ?? (me?.superadmin ? ["*"] : []), [me]);
  const isStaff = me?.superadmin === true;
  const can = useCallback((perm: AdminPerm) => hasPerm(izin, perm), [izin]);
  const modules = useMemo(() => ADMIN_MODULES.filter((m) => hasPerm(izin, m.perm)), [izin]);
  const active = moduleForPath(pathname);

  const reloadMe = useCallback(() => {
    void reload();
  }, [reload]);

  // 403 bisa berarti peran dicabut ATAU peran tidak punya izin modul itu: profil dimuat ulang dan
  // konsol hanya ditutup bila pengguna memang bukan staf lagi (efek di bawah).
  const guard = useCallback(
    <T,>(request: Promise<T>): Promise<T> =>
      request.catch((e: unknown) => {
        if (errorStatus(e) === 403) void reload();
        throw e;
      }),
    [reload]
  );

  const invalidate = useCallback(
    (keys: AdminTabKey[]) =>
      setRev((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] += 1;
        return next;
      }),
    []
  );

  const openTab = useCallback((key: AdminTabKey) => router.push(ADMIN_MODULES.find((m) => m.key === key)?.href ?? "/admin"), [router]);

  // Daftar paket dipakai modul Paket dan Workspace; dimuat sekali di sini.
  const plans = useRemote<AdminPlansResponse>(
    isStaff && (can("paket.lihat") || can("workspace.lihat")) ? `paket:${rev.paket}` : null,
    (signal) => guard(fetchAdminPlans(signal)),
    "Gagal memuat daftar paket."
  );

  const ctx = useMemo<AdminContextValue>(
    () => ({ guard, rev, invalidate, openTab, reloadMe, can, isSuper: izin.includes("*"), meId: me?.user.id ?? "", plans }),
    [guard, rev, invalidate, openTab, reloadMe, can, izin, me, plans]
  );

  // Ctrl/Cmd+K membuka pencarian cepat dari mana saja di konsol.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading && !me) return <ConsoleSkeleton />;

  if (!me) {
    return (
      <CenterCard>
        <AlertTriangle className="w-8 h-8 text-danger mx-auto" />
        <p className="mt-3 text-sm font-semibold text-fg">{error ?? "Gagal memuat profil."}</p>
        <button type="button" onClick={reloadMe} className={cn(BTN_PRIMARY, "mt-4")}>
          <RotateCw className="w-4 h-4" />
          Coba lagi
        </button>
      </CenterCard>
    );
  }

  if (!isStaff) {
    return (
      <CenterCard>
        <div className="mx-auto w-12 h-12 rounded-2xl bg-warning-soft text-warning flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-fg">Khusus admin platform</h1>
        <p className="mt-1.5 text-sm text-muted leading-relaxed">
          {revoked
            ? "Peran admin Anda sudah dicabut, jadi konsol ini ditutup."
            : "Konsol ini terpisah dari dashboard pelanggan dan hanya bisa dibuka oleh staf platform yang diberi peran admin."}
        </p>
        <Link href="/" className={cn(BTN_PRIMARY, "mt-5")}>
          <ArrowLeft className="w-4 h-4" />
          Ke Dashboard Workspace
        </Link>
      </CenterCard>
    );
  }

  const roleNama = me.admin?.roleNama ?? "Super Admin";
  const name = me.user.name ?? "";

  return (
    <AdminContext.Provider value={ctx}>
      <div className="flex min-h-screen w-full bg-canvas">
        {/* Sidebar desktop */}
        <aside className="hidden lg:flex flex-col w-64 bg-surface border-r border-line h-screen sticky top-0 shrink-0">
          <div className="h-16 flex items-center px-5 border-b border-line">
            <BrandMark />
          </div>
          <NavList modules={modules} active={active?.key ?? null} />
          <ProfileFooter name={name} username={me.user.username} roleNama={roleNama} />
        </aside>

        {/* Laci menu (layar kecil) */}
        {drawer && (
          <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu konsol">
            <button type="button" aria-label="Tutup menu" onClick={() => setDrawer(false)} className="absolute inset-0 bg-fg/30 cursor-default" />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface border-r border-line flex flex-col animate-[slide-in_160ms_ease-out]">
              <div className="h-16 flex items-center justify-between px-4 border-b border-line">
                <BrandMark />
                <button type="button" onClick={() => setDrawer(false)} aria-label="Tutup menu" className={ICON_BTN}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <NavList modules={modules} active={active?.key ?? null} onNavigate={() => setDrawer(false)} />
              <ProfileFooter name={name} username={me.user.username} roleNama={roleNama} />
            </aside>
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-16 sticky top-0 z-30 bg-surface border-b border-line flex items-center gap-2 px-4 lg:px-8">
            <button type="button" onClick={() => setDrawer(true)} aria-label="Buka menu" className={cn(ICON_BTN, "lg:hidden -ml-2")}>
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Lokasi" className="flex items-center gap-1.5 min-w-0 text-sm">
              <Link href="/admin" className="hidden sm:inline text-muted hover:text-fg font-medium shrink-0">
                Konsol Admin
              </Link>
              <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-faint shrink-0" />
              <span className="font-semibold text-fg truncate">{active?.label ?? "Konsol Admin"}</span>
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPalette(true)}
                className="hidden md:inline-flex items-center gap-2 h-9 w-60 px-3 rounded-lg border border-line bg-canvas text-[13px] text-faint hover:border-line-strong transition-colors cursor-pointer"
              >
                <Search className="w-4 h-4" />
                <span className="flex-1 text-left">Cari menu...</span>
                <kbd className="text-[11px] font-semibold text-muted">Ctrl K</kbd>
              </button>
              <button type="button" onClick={() => setPalette(true)} aria-label="Cari menu" className={cn(ICON_BTN, "md:hidden")}>
                <Search className="w-5 h-5" />
              </button>
              <span className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                {roleNama}
              </span>
              <ThemeToggle />
            </div>
          </header>

          {/* Rata kiri, sejajar dengan breadcrumb; lebar dibatasi supaya baris tidak terlalu panjang di layar lebar. */}
          <main className="flex-1 w-full max-w-[1440px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
      {palette && <CommandPalette modules={modules} onClose={() => setPalette(false)} />}
    </AdminContext.Provider>
  );
}

/* ------------------------------------------------------------------ halaman modul */

/**
 * Bungkus satu halaman modul: judul dan penjelasannya, tombol tambahan, dan penjaga izin. Server tetap
 * menegakkan izin yang sama; ini hanya supaya staf tanpa izin melihat penjelasan, bukan galat.
 */
export function AdminPage({ module, actions, children }: { module: AdminTabKey; actions?: React.ReactNode; children: React.ReactNode }) {
  const { can } = useAdmin();
  const m = ADMIN_MODULES.find((x) => x.key === module) ?? ADMIN_MODULES[0];
  const allowed = can(m.perm);
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-fg tracking-tight">{m.label}</h1>
          <p className="mt-1 text-sm text-muted max-w-2xl">{m.subtitle}</p>
        </div>
        {allowed && actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {allowed ? (
        children
      ) : (
        <div className="card p-8 text-center max-w-lg mx-auto">
          <div className="mx-auto w-11 h-11 rounded-2xl bg-subtle text-muted flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <p className="mt-3 text-sm font-semibold text-fg">Peran Anda tidak punya akses ke modul ini</p>
          <p className="mt-1 text-sm text-muted">Minta Super Admin menambahkan izin &quot;{m.label}&quot; ke peran Anda.</p>
          <Link href="/admin" className={cn(BTN_OUTLINE, "mt-4")}>
            Kembali ke ringkasan
          </Link>
        </div>
      )}
    </div>
  );
}
