"use client";

import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CreditCard,
  Megaphone,
  Package,
  Users,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAdminOverview } from "@/lib/admin-client";
import type { AdminOverviewResponse } from "@/lib/admin-types";
import { SLOT_STATUS_LABEL, type SlotStatus } from "@/lib/autopilot-types";
import { formatRupiah } from "@/lib/plan-types";
import { formatWibFull } from "@/lib/scheduling";
import { Banner, ListSkeleton, SLOT_STATUS_STYLE, durationText } from "@/components/autopilot/shared";
import { formatInt } from "@/components/settings/format";
import { BTN_OUTLINE, Pill, RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, humanize, useAdmin } from "./shared";

const LOAD_ERROR = "Gagal memuat ringkasan platform.";
/** Penjadwal berjalan tiap 5 menit; tiga tick terlewat dianggap berhenti. */
const TICK_STALE_MS = 15 * 60_000;
const SLOT_ORDER: SlotStatus[] = ["DIRENCANAKAN", "MENULIS", "MENUNGGU_TINJAU", "TERANTRE", "TERBIT", "GAGAL", "DILEWATI", "DIBATALKAN"];

type Tone = "success" | "warning" | "danger";
const TONE_ICON: Record<Tone, { Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  success: { Icon: CheckCircle2, cls: "text-success" },
  warning: { Icon: AlertTriangle, cls: "text-warning" },
  danger: { Icon: XCircle, cls: "text-danger" },
};

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "danger" | "warning" | "success" | "accent";
  hint?: string;
}) {
  return (
    <div className="card p-3.5 min-w-0">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold tabular-nums truncate",
          tone === "danger"
            ? "text-danger"
            : tone === "warning"
              ? "text-warning"
              : tone === "success"
                ? "text-success"
                : tone === "accent"
                  ? "text-accent"
                  : "text-fg"
        )}
      >
        {typeof value === "number" ? formatInt(value) : value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted leading-snug">{hint}</p>}
    </div>
  );
}

function KpiProgressCard({
  label,
  pct,
  subtitle,
  tone = "accent",
}: {
  label: string;
  pct: number;
  subtitle: string;
  tone?: "accent" | "success" | "warning" | "danger";
}) {
  const safePct = Math.max(0, Math.min(100, pct));
  const barCls =
    tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : tone === "danger" ? "bg-danger" : "bg-accent";
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <span className="text-lg font-extrabold text-fg tabular-nums">{safePct}%</span>
      </div>
      <div className="h-2 rounded-full bg-subtle overflow-hidden" aria-hidden="true">
        <div className={cn("h-full rounded-full transition-all", barCls)} style={{ width: `${safePct}%` }} />
      </div>
      <p className="text-xs text-muted leading-snug">{subtitle}</p>
    </div>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-fg">{title}</h3>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

interface Check {
  label: string;
  tone: Tone;
  detail: string;
}

/** Keadaan saklar sistem dalam bahasa sehari-hari. */
function systemChecks(data: AdminOverviewResponse): Check[] {
  const { flags, signupEnv, publishEnv } = data;
  return [
    !signupEnv
      ? {
          label: "Pendaftaran mandiri",
          tone: "warning",
          detail: `Tertutup di tingkat server (SIGNUP_ENABLED mati). Saklar di tab Sistem ${flags.signupOpen ? "menyala" : "mati"}, tetapi belum berpengaruh.`,
        }
      : flags.signupOpen
        ? { label: "Pendaftaran mandiri", tone: "success", detail: "Terbuka. Siapa pun bisa mendaftar dan membuat workspace baru." }
        : { label: "Pendaftaran mandiri", tone: "warning", detail: "Ditutup dari tab Sistem. Pengguna baru hanya bisa masuk lewat undangan." },
    flags.autopilotGlobal
      ? { label: "Autopilot global", tone: "success", detail: "Menyala. Autopilot berjalan di setiap workspace yang mengaktifkannya." }
      : { label: "Autopilot global", tone: "danger", detail: "Dihentikan untuk semua workspace (saklar darurat di tab Sistem)." },
    publishEnv
      ? { label: "Saklar posting server", tone: "success", detail: "Menyala. Dashboard boleh mengirim posting ke Threads." }
      : {
          label: "Saklar posting server",
          tone: "warning",
          detail: "Mati (CONTENT_PUBLISH_ENABLED). Tidak ada posting yang dikirim dari dashboard, termasuk dari autopilot.",
        },
  ];
}

/** Tab Ringkasan: KPI SaaS standar industri, metrik finansial, pengguna, workspace, akun, autopilot, dan saklar sistem. */
export function OverviewTab() {
  const { guard, rev, openTab } = useAdmin();
  const { data, error, status, loading, refreshing, reload } = useRemote<AdminOverviewResponse>(
    `ringkasan:${rev.ringkasan}`,
    (signal) => guard(fetchAdminOverview(signal)),
    LOAD_ERROR
  );

  if (loading) return <ListSkeleton label="Memuat ringkasan platform" rows={4} />;
  if (!data) return <AdminLoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;

  const { users, workspaces, accounts, autopilot, flags, kpi } = data;

  // Dua-duanya jam server, jadi jam perangkat yang meleset tidak membuat penjadwal tampak mati.
  const now = Date.parse(data.serverNow);
  const tickAt = autopilot.tickTerakhir ? Date.parse(autopilot.tickTerakhir) : NaN;
  const tickAge = Number.isFinite(now) && Number.isFinite(tickAt) ? Math.max(0, now - tickAt) : null;
  const tick: { tone: Tone; text: string } =
    tickAge === null
      ? { tone: "warning", text: "Penjadwal belum pernah berjalan. Autopilot baru bekerja setelah cron di server memanggil tick." }
      : tickAge > TICK_STALE_MS
        ? { tone: "warning", text: `Penjadwal tampak berhenti: tick terakhir ${durationText(tickAge)} lalu, seharusnya tiap 5 menit.` }
        : { tone: "success", text: `Penjadwal aktif. Tick terakhir ${durationText(tickAge)} lalu.` };

  const slots = Object.entries(autopilot.slot24Jam)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => {
      const ia = SLOT_ORDER.indexOf(a as SlotStatus);
      const ib = SLOT_ORDER.indexOf(b as SlotStatus);
      return (ia < 0 ? SLOT_ORDER.length : ia) - (ib < 0 ? SLOT_ORDER.length : ib);
    });
  const checks = systemChecks(data);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Metrik eksekutif & KPI standar industri SaaS per{" "}
            <time dateTime={data.serverNow} className="font-semibold text-fg">
              {Number.isFinite(now) ? formatWibFull(new Date(now)) : "-"}
            </time>
            .
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => openTab("integrasi")} className={BTN_OUTLINE}>
              Integrasi & API Keys
            </button>
            <RefreshButton onClick={reload} busy={refreshing} />
          </div>
        </div>
        <RefreshError error={error} onRetry={reload} />
      </div>

      {/* KPI Standar Industri SaaS: Revenue & Monetisasi */}
      {kpi && (
        <>
          <Section
            title="KPI Pendapatan & Monetisasi SaaS (Standar Industri)"
            hint="Pendapatan berulang bulanan (MRR), proyeksi tahunan (ARR), nilai rata-rata pelanggan berbayar (ARPU), dan kas masuk."
            action={
              <button type="button" onClick={() => openTab("transaksi")} className={BTN_OUTLINE}>
                <CreditCard className="w-3.5 h-3.5" />
                Kelola Transaksi ({formatInt(kpi.pendingInvoices)} menunggu)
              </button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Tile
                label="MRR (Bulanan)"
                value={formatRupiah(kpi.mrr)}
                tone="accent"
                hint="Monthly Recurring Revenue"
              />
              <Tile
                label="ARR (Tahunan)"
                value={formatRupiah(kpi.arr)}
                hint="Annual Run Rate (12x MRR)"
              />
              <Tile
                label="ARPU"
                value={formatRupiah(kpi.arpu)}
                hint="Rata-rata per tenant berbayar"
              />
              <Tile
                label="Pendapatan 30 Hari"
                value={formatRupiah(kpi.revenue30d)}
                tone={kpi.revenue30d > 0 ? "success" : undefined}
                hint={`${formatInt(kpi.paidInvoices)} tagihan lunas`}
              />
              <Tile
                label="Total Kas Masuk"
                value={formatRupiah(kpi.totalRevenue)}
                hint="Akumulasi invoice PAID"
              />
              <Tile
                label="Risiko Churn (7 Hari)"
                value={kpi.expiringSoon7d + kpi.expiredWorkspaces}
                tone={kpi.expiredWorkspaces > 0 ? "danger" : kpi.expiringSoon7d > 0 ? "warning" : undefined}
                hint={`${formatInt(kpi.expiringSoon7d)} segera habis · ${formatInt(kpi.expiredWorkspaces)} kedaluwarsa`}
              />
            </div>
          </Section>

          {/* Rasio Konversi, Aktivasi, Adopsi & SLA */}
          <Section
            title="Kesehatan Corong SaaS & Keandalan Operasional"
            hint="Indikator performa akuisisi, aktivasi tenant, adopsi fitur inti AI, dan keandalan terbit 24 jam."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiProgressCard
                label="Paid Conversion Rate"
                pct={kpi.conversionRate}
                tone="accent"
                subtitle={`${formatInt(kpi.paidWorkspaces)} tenant berbayar dari ${formatInt(workspaces.total)} workspace (${formatInt(kpi.freeWorkspaces)} trial)`}
              />
              <KpiProgressCard
                label="Tenant Activation Rate"
                pct={kpi.tenantActivationRate}
                tone={kpi.tenantActivationRate >= 70 ? "success" : "warning"}
                subtitle={`${formatInt(Math.max(0, workspaces.total - workspaces.tanpaAkun))} dari ${formatInt(workspaces.total)} workspace sudah menghubungkan akun Threads`}
              />
              <KpiProgressCard
                label="Autopilot Adoption Rate"
                pct={kpi.autopilotAdoptionRate}
                tone="accent"
                subtitle={`${formatInt(autopilot.otomatis + autopilot.tinjau)} dari ${formatInt(accounts.total)} akun Threads menyalakan Autopilot AI`}
              />
              <KpiProgressCard
                label="Publish SLA (24 Jam)"
                pct={kpi.publishSuccessRate24h}
                tone={kpi.publishSuccessRate24h >= 95 ? "success" : kpi.publishSuccessRate24h >= 80 ? "warning" : "danger"}
                subtitle="Rasio keberhasilan posting otomatis dibanding kegagalan dalam 24 jam"
              />
            </div>
          </Section>

          {/* Distribusi Paket Langganan */}
          {kpi.planBreakdown.length > 0 && (
            <Section
              title="Distribusi Paket Sewa & Kontribusi MRR"
              hint="Jumlah pelanggan aktif di setiap paket dan kontribusinya terhadap MRR bulanan."
              action={
                <button type="button" onClick={() => openTab("paket")} className={BTN_OUTLINE}>
                  <Package className="w-3.5 h-3.5" />
                  Atur Paket & Harga
                </button>
              }
            >
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-subtle text-xs font-semibold text-muted border-b border-line">
                      <tr>
                        <th className="py-2.5 px-4">Nama Paket</th>
                        <th className="py-2.5 px-4">Harga / Bulan</th>
                        <th className="py-2.5 px-4">Workspace Aktif</th>
                        <th className="py-2.5 px-4 text-right">Kontribusi MRR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {kpi.planBreakdown.map((p) => (
                        <tr key={p.planId} className="hover:bg-subtle/50 transition-colors">
                          <td className="py-2.5 px-4 font-semibold text-fg">
                            {p.nama}{" "}
                            <span className="font-mono text-[11px] font-normal text-muted">({p.planId})</span>
                          </td>
                          <td className="py-2.5 px-4 tabular-nums text-muted">
                            {p.hargaBulanan === 0 ? "Gratis (Rp 0)" : formatRupiah(p.hargaBulanan)}
                          </td>
                          <td className="py-2.5 px-4 tabular-nums">
                            <Pill tone={p.count > 0 ? "accent" : "neutral"}>{formatInt(p.count)} workspace</Pill>
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold text-fg tabular-nums">
                            {formatRupiah(p.mrrContribution)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      <Section
        title="Pertumbuhan & Aktivitas Pengguna"
        action={
          <button type="button" onClick={() => openTab("pengguna")} className={BTN_OUTLINE}>
            <Users className="w-3.5 h-3.5" />
            Kelola Pengguna
          </button>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Total Pengguna" value={users.total} />
          <Tile label="Pengguna Aktif" value={users.aktif} />
          <Tile label="Diblokir" value={users.diblokir} tone={users.diblokir > 0 ? "danger" : undefined} />
          <Tile label="Super Admin" value={users.superadmin} />
          <Tile label="Pendaftar 7 Hari" value={users.baru7Hari} tone={users.baru7Hari > 0 ? "success" : undefined} />
          <Tile label="Aktif 24 Jam (DAU)" value={users.masuk24Jam} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Section
            title="Tenant Workspace"
            action={
              <button type="button" onClick={() => openTab("workspace")} className={BTN_OUTLINE}>
                Kelola Workspace
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Tile label="Total Workspace" value={workspaces.total} />
              <Tile label="Ditangguhkan" value={workspaces.ditangguhkan} tone={workspaces.ditangguhkan > 0 ? "danger" : undefined} />
              <Tile label="Belum Konek Akun" value={workspaces.tanpaAkun} hint="Belum punya akun Threads." />
            </div>
          </Section>
        </div>
        <div className="lg:col-span-2">
          <Section title="Akun Threads Terhubung">
            <div className="grid grid-cols-2 gap-3">
              <Tile label="Total Akun" value={accounts.total} />
              <Tile
                label="Tanpa Pemilik"
                value={accounts.tanpaPemilik}
                tone={accounts.tanpaPemilik > 0 ? "warning" : undefined}
                hint="Belum ditautkan ke tenant."
              />
            </div>
          </Section>
        </div>
      </div>

      {accounts.tanpaPemilik > 0 && (
        <Banner tone="warning">
          <p className="font-bold">{formatInt(accounts.tanpaPemilik)} akun Threads belum bisa dilihat siapa pun di dashboard.</p>
          <p className="mt-0.5">
            Workspace sumber tempat akun itu berada belum ditautkan ke workspace dashboard yang punya anggota. Tautkan lewat tab Sumber akun.
          </p>
          <button type="button" onClick={() => openTab("sumber")} className={cn(BTN_OUTLINE, "mt-2.5 bg-surface")}>
            Buka Sumber akun
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </Banner>
      )}

      <Section title="Mesin Autopilot AI" hint="Jumlah akun per mode di semua workspace dan status cron penjadwal.">
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Mode Otomatis Penuh" value={autopilot.otomatis} />
          <Tile label="Mode Tinjau Dulu" value={autopilot.tinjau} />
          <Tile label="Dijeda" value={autopilot.dijeda} tone={autopilot.dijeda > 0 ? "warning" : undefined} />
        </div>
        <Banner tone={tick.tone}>
          {tick.text}
          {autopilot.tickTerakhir && Number.isFinite(tickAt) && (
            <span className="font-normal"> ({formatWibFull(new Date(tickAt))})</span>
          )}
        </Banner>
        <div className="card p-4">
          <h4 className="text-[13px] font-bold text-fg flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            Distribusi Slot Autopilot (24 Jam Terakhir & Mendatang)
          </h4>
          {slots.length === 0 ? (
            <p className="mt-1 flex items-center gap-2 text-[13px] text-muted">
              <CircleDashed className="w-4 h-4 shrink-0" />
              Tidak ada slot autopilot dalam rentang ini.
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1">
              {slots.map(([key, n]) => {
                const style = SLOT_STATUS_STYLE[key as SlotStatus];
                const Icon = style?.Icon ?? CircleDashed;
                return (
                  <li key={key} className="flex items-center gap-2 py-1 text-[13px]">
                    <Icon className={cn("w-4 h-4 shrink-0", key === "GAGAL" ? "text-danger" : key === "TERBIT" ? "text-success" : "text-muted")} />
                    <span className="flex-1 min-w-0 truncate text-muted">{SLOT_STATUS_LABEL[key as SlotStatus] ?? humanize(key)}</span>
                    <span className="font-bold text-fg tabular-nums">{formatInt(n)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Saklar Sistem & Status Platform">
        <div className="card p-4">
          <ul className="divide-y divide-line">
            {checks.map((c) => {
              const { Icon, cls } = TONE_ICON[c.tone];
              return (
                <li key={c.label} className="py-2.5 first:pt-0 flex items-start gap-2.5">
                  <Icon className={cn("w-[18px] h-[18px] mt-0.5 shrink-0", cls)} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-fg">{c.label}</p>
                    <p className="text-[13px] text-muted break-words">{c.detail}</p>
                  </div>
                </li>
              );
            })}
            <li className="py-2.5 flex items-start gap-2.5">
              <Megaphone className={cn("w-[18px] h-[18px] mt-0.5 shrink-0", flags.announcement ? "text-accent" : "text-muted")} />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-fg">Pengumuman Global</p>
                <p className="text-[13px] text-muted break-words">
                  {flags.announcement ? `Tampil untuk semua pengguna: "${flags.announcement}"` : "Tidak ada pengumuman yang sedang tampil."}
                </p>
              </div>
            </li>
          </ul>
          <div className="mt-1.5 flex justify-end">
            <button type="button" onClick={() => openTab("sistem")} className={BTN_OUTLINE}>
              Ubah di tab Sistem
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
