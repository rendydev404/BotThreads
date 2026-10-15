"use client";

import React from "react";
import { AtSign, Building2, CircleDashed, Users, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAdminOverview } from "@/lib/admin-client";
import type { AdminOverviewResponse } from "@/lib/admin-types";
import { SLOT_STATUS_LABEL, type SlotStatus } from "@/lib/autopilot-types";
import { formatWibFull } from "@/lib/scheduling";
import { ListSkeleton, SLOT_STATUS_STYLE, durationText } from "@/components/autopilot/shared";
import { formatInt } from "@/components/settings/format";
import { RefreshButton } from "@/components/settings/states";
import { useRemote } from "@/components/settings/use-remote";
import { AdminLoadError, RefreshError, humanize, useAdmin } from "./shared";
import { AttentionList, KpiCard, Meter, Panel, PanelLink, StatStrip, StatusDot, rupiah, type AttentionItem, type Tone } from "./ui";

const LOAD_ERROR = "Gagal memuat ringkasan platform.";
/** Penjadwal berjalan tiap 5 menit; tiga tick terlewat dianggap berhenti. */
const TICK_STALE_MS = 15 * 60_000;
const SLOT_ORDER: SlotStatus[] = ["DIRENCANAKAN", "MENULIS", "MENUNGGU_TINJAU", "TERANTRE", "TERBIT", "GAGAL", "DILEWATI", "DIBATALKAN"];

const pctTone = (pct: number, good: number, ok: number): Tone => (pct >= good ? "success" : pct >= ok ? "warning" : "danger");

/** Beranda konsol: apa yang perlu ditangani, angka utama, lalu rincian per area. */
export function OverviewTab() {
  const { guard, rev, can } = useAdmin();
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
  const tickStale = tickAge === null || tickAge > TICK_STALE_MS;

  const slots = Object.entries(autopilot.slot24Jam)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => {
      const ia = SLOT_ORDER.indexOf(a as SlotStatus);
      const ib = SLOT_ORDER.indexOf(b as SlotStatus);
      return (ia < 0 ? SLOT_ORDER.length : ia) - (ib < 0 ? SLOT_ORDER.length : ib);
    });

  // Hal yang butuh tindakan, paling mendesak dulu. Tautan hanya untuk modul yang boleh dibuka peran ini.
  const link = (label: string, href: string, perm: Parameters<typeof can>[0]) => (can(perm) ? { label, href } : undefined);
  const attention: AttentionItem[] = [];
  if (!flags.autopilotGlobal)
    attention.push({ key: "ap", tone: "danger", title: "Autopilot dihentikan untuk semua workspace", detail: "Saklar darurat sedang aktif.", action: link("Saklar sistem", "/admin/sistem", "sistem.lihat") });
  if (tickStale)
    attention.push({
      key: "tick",
      tone: "warning",
      title: tickAge === null ? "Penjadwal autopilot belum pernah berjalan" : `Penjadwal autopilot berhenti ${durationText(tickAge)} lalu`,
      detail:
        tickAge === null
          ? "Autopilot baru bekerja setelah cron di server memanggil tick."
          : `Seharusnya berjalan tiap 5 menit. Tick terakhir ${formatWibFull(new Date(tickAt))}. Periksa cron di server.`,
    });
  if (kpi && kpi.publishSuccessRate24h < 80)
    attention.push({ key: "sla", tone: "danger", title: `Hanya ${kpi.publishSuccessRate24h}% posting berhasil terbit dalam 24 jam`, action: link("Lihat antrean", "/admin/konten", "konten.lihat") });
  if (kpi && kpi.pendingInvoices > 0)
    attention.push({ key: "inv", tone: "info", title: `${formatInt(kpi.pendingInvoices)} tagihan menunggu pembayaran atau verifikasi`, action: link("Tagihan", "/admin/transaksi", "tagihan.lihat") });
  if (kpi && kpi.expiredWorkspaces + kpi.expiringSoon7d > 0)
    attention.push({
      key: "churn",
      tone: kpi.expiredWorkspaces > 0 ? "warning" : "info",
      title: `${formatInt(kpi.expiredWorkspaces)} paket kedaluwarsa, ${formatInt(kpi.expiringSoon7d)} habis dalam 7 hari`,
      detail: "Hubungi pelanggan sebelum autopilot mereka berhenti.",
      action: link("Workspace", "/admin/workspace", "workspace.lihat"),
    });
  if (accounts.tanpaPemilik > 0)
    attention.push({
      key: "src",
      tone: "warning",
      title: `${formatInt(accounts.tanpaPemilik)} akun Threads belum terlihat siapa pun`,
      detail: "Workspace sumbernya belum ditautkan ke tenant yang punya anggota.",
      action: link("Tautkan", "/admin/sumber", "sumber.lihat"),
    });
  if (workspaces.ditangguhkan > 0)
    attention.push({ key: "susp", tone: "info", title: `${formatInt(workspaces.ditangguhkan)} workspace sedang ditangguhkan`, action: link("Workspace", "/admin/workspace", "workspace.lihat") });

  const activeWs = Math.max(0, workspaces.total - workspaces.tanpaAkun);
  const apAccounts = autopilot.otomatis + autopilot.tinjau;

  const systemRows: { label: string; tone: Tone; text: string }[] = [
    {
      label: "Pendaftaran mandiri",
      tone: !data.signupEnv ? "warning" : flags.signupOpen ? "success" : "warning",
      text: !data.signupEnv ? "Tertutup di server (SIGNUP_ENABLED)" : flags.signupOpen ? "Terbuka untuk umum" : "Hanya lewat undangan",
    },
    { label: "Autopilot global", tone: flags.autopilotGlobal ? "success" : "danger", text: flags.autopilotGlobal ? "Menyala" : "Dihentikan" },
    { label: "Posting ke Threads", tone: data.publishEnv ? "success" : "warning", text: data.publishEnv ? "Menyala" : "Mati (CONTENT_PUBLISH_ENABLED)" },
    { label: "Pengumuman", tone: flags.announcement ? "accent" : "neutral", text: flags.announcement ? `“${flags.announcement}”` : "Tidak ada" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Data per{" "}
          <time dateTime={data.serverNow} className="font-medium text-fg">
            {Number.isFinite(now) ? formatWibFull(new Date(now)) : "-"}
          </time>
        </p>
        <RefreshButton onClick={reload} busy={refreshing} />
      </div>
      <RefreshError error={error} onRetry={reload} />

      <Panel title="Perlu perhatian" description={attention.length ? `${attention.length} hal menunggu tindakan` : undefined}>
        <AttentionList items={attention} okText="Semua berjalan normal. Tidak ada yang perlu ditangani." />
      </Panel>

      {/* Angka utama */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard label="Pendapatan bulanan (MRR)" value={kpi ? rupiah(kpi.mrr) : "-"} hint={kpi ? `${rupiah(kpi.arr)} per tahun` : "Paket belum dipasang"} Icon={Wallet} tone="success" />
        <KpiCard label="Pengguna aktif" value={formatInt(users.aktif)} hint={`${formatInt(users.baru7Hari)} baru minggu ini · ${formatInt(users.masuk24Jam)} masuk hari ini`} Icon={Users} />
        <KpiCard
          label="Workspace"
          value={formatInt(workspaces.total)}
          hint={kpi ? `${formatInt(kpi.paidWorkspaces)} berbayar · ${formatInt(kpi.freeWorkspaces)} trial` : `${formatInt(activeWs)} sudah terhubung`}
          Icon={Building2}
        />
        <KpiCard label="Akun Threads" value={formatInt(accounts.total)} hint={`${formatInt(apAccounts)} memakai autopilot`} Icon={AtSign} />
      </div>

      {kpi && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Panel
            title="Pendapatan"
            description="Kas masuk dan sebaran pelanggan per paket"
            action={can("paket.lihat") ? <PanelLink href="/admin/paket">Atur paket</PanelLink> : undefined}
            className="lg:col-span-3"
          >
            <StatStrip
              items={[
                { label: "30 hari terakhir", value: rupiah(kpi.revenue30d), hint: `${formatInt(kpi.paidInvoices)} tagihan lunas` },
                { label: "Total kas masuk", value: rupiah(kpi.totalRevenue) },
                { label: "Rata-rata per pelanggan", value: rupiah(kpi.arpu), hint: "ARPU" },
              ]}
            />
            {kpi.planBreakdown.length > 0 && (
              <table className="mt-5 w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted border-b border-line">
                    <th scope="col" className="text-left font-medium pb-2">Paket</th>
                    <th scope="col" className="text-right font-medium pb-2 hidden sm:table-cell">Harga</th>
                    <th scope="col" className="text-right font-medium pb-2">Workspace</th>
                    <th scope="col" className="text-right font-medium pb-2">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {kpi.planBreakdown.map((p) => (
                    <tr key={p.planId} className="border-b border-line last:border-0">
                      <td className="py-2.5 font-medium text-fg">{p.nama}</td>
                      <td className="py-2.5 text-right tabular-nums text-muted hidden sm:table-cell">{p.hargaBulanan > 0 ? rupiah(p.hargaBulanan) : "Gratis"}</td>
                      <td className={cn("py-2.5 text-right tabular-nums", p.count > 0 ? "text-fg" : "text-faint")}>{formatInt(p.count)}</td>
                      <td className={cn("py-2.5 text-right tabular-nums font-medium", p.mrrContribution > 0 ? "text-fg" : "text-faint")}>{rupiah(p.mrrContribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title="Kesehatan" description="Corong pelanggan dan keandalan terbit" className="lg:col-span-2" bodyClassName="space-y-5">
            <Meter label="Konversi ke berbayar" pct={kpi.conversionRate} tone="accent" caption={`${formatInt(kpi.paidWorkspaces)} dari ${formatInt(workspaces.total)} workspace`} />
            <Meter label="Aktivasi tenant" pct={kpi.tenantActivationRate} tone={pctTone(kpi.tenantActivationRate, 70, 40)} caption={`${formatInt(activeWs)} workspace sudah menghubungkan akun`} />
            <Meter label="Adopsi autopilot" pct={kpi.autopilotAdoptionRate} tone="accent" caption={`${formatInt(apAccounts)} dari ${formatInt(accounts.total)} akun`} />
            <Meter label="Posting berhasil (24 jam)" pct={kpi.publishSuccessRate24h} tone={pctTone(kpi.publishSuccessRate24h, 95, 80)} />
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pengguna" action={can("pengguna.lihat") ? <PanelLink href="/admin/pengguna">Kelola</PanelLink> : undefined}>
          <StatStrip
            items={[
              { label: "Total", value: formatInt(users.total) },
              { label: "Baru 7 hari", value: formatInt(users.baru7Hari), tone: users.baru7Hari > 0 ? "success" : "neutral" },
              { label: "Masuk 24 jam", value: formatInt(users.masuk24Jam) },
              { label: "Diblokir", value: formatInt(users.diblokir), tone: users.diblokir > 0 ? "danger" : "neutral" },
            ]}
          />
        </Panel>
        <Panel title="Workspace & akun" action={can("workspace.lihat") ? <PanelLink href="/admin/workspace">Kelola</PanelLink> : undefined}>
          <StatStrip
            items={[
              { label: "Belum terhubung", value: formatInt(workspaces.tanpaAkun), hint: "tanpa akun Threads", tone: workspaces.tanpaAkun > 0 ? "warning" : "neutral" },
              { label: "Ditangguhkan", value: formatInt(workspaces.ditangguhkan), tone: workspaces.ditangguhkan > 0 ? "danger" : "neutral" },
              { label: "Akun tanpa pemilik", value: formatInt(accounts.tanpaPemilik), tone: accounts.tanpaPemilik > 0 ? "warning" : "neutral" },
              ...(kpi ? [{ label: "Habis ≤ 7 hari", value: formatInt(kpi.expiringSoon7d), tone: (kpi.expiringSoon7d > 0 ? "warning" : "neutral") as Tone }] : []),
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          title="Autopilot AI"
          description={tickStale ? "Penjadwal tidak berjalan" : `Penjadwal aktif · tick ${durationText(tickAge ?? 0)} lalu`}
          action={can("konten.lihat") ? <PanelLink href="/admin/konten">Antrean</PanelLink> : undefined}
          className="lg:col-span-3"
        >
          <StatStrip
            items={[
              { label: "Otomatis penuh", value: formatInt(autopilot.otomatis) },
              { label: "Tinjau dulu", value: formatInt(autopilot.tinjau) },
              { label: "Dijeda", value: formatInt(autopilot.dijeda), tone: autopilot.dijeda > 0 ? "warning" : "neutral" },
            ]}
          />
          <div className="mt-5 pt-4 border-t border-line">
            <p className="text-xs text-muted mb-2.5">Slot 24 jam terakhir & mendatang</p>
            {slots.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <CircleDashed className="w-4 h-4 shrink-0" />
                Tidak ada slot dalam rentang ini.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {slots.map(([key, n]) => {
                  const style = SLOT_STATUS_STYLE[key as SlotStatus];
                  return (
                    <li key={key} className={cn("inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium", style?.chip ?? "bg-subtle text-muted")}>
                      {SLOT_STATUS_LABEL[key as SlotStatus] ?? humanize(key)}
                      <span className="font-semibold tabular-nums">{formatInt(n)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title="Status sistem" action={can("sistem.lihat") ? <PanelLink href="/admin/sistem">Ubah</PanelLink> : undefined} className="lg:col-span-2">
          <ul className="-my-2.5 divide-y divide-line">
            {systemRows.map((r) => (
              <li key={r.label} className="py-2.5 flex items-center gap-3">
                <StatusDot tone={r.tone} />
                <span className="text-[13px] text-muted shrink-0">{r.label}</span>
                <span className="ml-auto text-[13px] font-medium text-fg text-right truncate min-w-0" title={r.text}>
                  {r.text}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
