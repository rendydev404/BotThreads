"use client";

import React, { Activity, useState } from "react";
import { AlertTriangle, CheckCircle2, HeartPulse, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAutopilotHealth } from "@/lib/notification-client";
import type { HealthResponse, HealthRunDTO } from "@/lib/notification-types";
import { formatWibFull } from "@/lib/scheduling";
import { Banner, ListSkeleton, Segmented, durationText, type SegmentedOption } from "@/components/autopilot/shared";
import { formatInt, formatMs } from "./format";
import { PerformancePanel } from "./performance-panel";
import { EmptyState, LoadError, NotInstalled, Pill, RefreshButton } from "./states";
import { useRemote } from "./use-remote";

const LOAD_ERROR = "Gagal memuat kesehatan autopilot.";
/** Riwayat tick yang langsung terlihat; sisanya lewat "Tampilkan semua". */
const RUNS_SHOWN = 8;

/** Hitungan per tick (`hitung`) dalam bahasa manusia. Kunci yang belum dikenal dirapikan lewat `humanize`. */
const COUNT_LABEL: Record<string, string> = {
  direncanakan: "slot direncanakan",
  diklaim: "slot dikerjakan",
  putaranAi: "putaran AI",
  diantre: "diantrekan",
  tinjau: "menunggu tinjauan",
  terbit: "terbit",
  gagalTerbit: "gagal terbit",
  gagalTulis: "gagal ditulis",
  dilewati: "dilewati",
  ditunda: "ditunda",
  dilepas: "dilepas",
  dibatalkan: "dibatalkan",
  kedaluwarsa: "kedaluwarsa",
  dijeda: "akun dijeda",
  dilanjutkan: "akun dilanjutkan",
  modeDiturunkan: "mode diturunkan",
  ideBaru: "ide baru",
  ideGagal: "ide gagal dibuat",
  viral: "posting viral",
  penerbitTelat: "posting telat terbit",
  risetGagal: "riset tren gagal",
  belajarGagal: "pembelajaran gagal",
};
/** Penanda keadaan (bukan jumlah): tampil sebagai kalimat tanpa angka. */
const FLAG_LABEL: Record<string, string> = {
  saklarMati: "saklar posting mati",
  radarBelumDipasang: "radar belum dipasang",
  belajarBelumDipasang: "pembelajaran belum dipasang",
};
const TROUBLE_KEYS = new Set(["gagalTerbit", "gagalTulis", "ideGagal", "penerbitTelat", "risetGagal", "belajarGagal"]);

/** "putaranAi" menjadi "putaran ai" untuk kunci yang belum punya label. */
const humanize = (key: string): string => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

type Tone = "success" | "warning" | "danger";
type CheckTone = Tone | "unknown";
const TONE_ICON: Record<CheckTone, { Icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  success: { Icon: CheckCircle2, cls: "text-success" },
  warning: { Icon: AlertTriangle, cls: "text-warning" },
  danger: { Icon: XCircle, cls: "text-danger" },
  unknown: { Icon: Info, cls: "text-muted" },
};

interface Check {
  label: string;
  tone: CheckTone;
  detail: string;
}

/**
 * Pemeriksaan konfigurasi. Saklar posting dibaca dari keadaan server saat ini; sisanya dari penanda
 * yang dicatat satu tick. Hanya tick tanpa galat yang dipakai: tick yang gagal di tengah jalan belum
 * sempat mencatat semua penandanya.
 */
function configChecks(run: HealthRunDTO, publishEnabled: boolean): Check[] {
  const flag = (key: string): number => run.hitung[key] ?? 0;
  // Riset tren dilewati pada tick yang berjalan saat saklar mati, walau saklarnya kini sudah menyala.
  const switchOff = !publishEnabled || flag("saklarMati") > 0;
  return [
    !publishEnabled
      ? { label: "Saklar posting dashboard", tone: "warning", detail: "Mati. Autopilot tetap menyusun rencana, tetapi tidak menulis atau memposting." }
      : { label: "Saklar posting dashboard", tone: "success", detail: "Menyala. Autopilot boleh menulis dan mengantrekan posting." },
    switchOff
      ? // Riset tren dilewati selama saklar mati, jadi keadaannya tidak diketahui dari tick ini.
        { label: "Radar tren dan bank ide", tone: "unknown", detail: "Tidak diperiksa selama saklar posting mati." }
      : flag("radarBelumDipasang")
        ? { label: "Radar tren dan bank ide", tone: "warning", detail: "Belum dipasang (sql/006_autopilot_radar.sql). Autopilot menulis tanpa sinyal tren." }
        : flag("risetGagal")
          ? { label: "Radar tren dan bank ide", tone: "warning", detail: "Terpasang, tetapi riset tren gagal pada tick ini." }
          : { label: "Radar tren dan bank ide", tone: "success", detail: "Terpasang dan berjalan." },
    flag("belajarBelumDipasang")
      ? { label: "Pembelajaran kinerja", tone: "warning", detail: "Belum dipasang (sql/007_autopilot_learning.sql). Autopilot belum belajar dari hasil posting." }
      : flag("belajarGagal")
        ? { label: "Pembelajaran kinerja", tone: "warning", detail: "Terpasang, tetapi gagal dijalankan pada tick ini." }
        : { label: "Pembelajaran kinerja", tone: "success", detail: "Terpasang dan berjalan." },
    flag("penerbitTelat")
      ? {
          label: "Penerbit posting",
          tone: "danger",
          detail: `${formatInt(flag("penerbitTelat"))} posting sudah lewat jadwal tetapi belum diambil penerbit. Autopilot berhenti menambah antrean sampai penerbit berjalan lagi.`,
        }
      : { label: "Penerbit posting", tone: "success", detail: "Tidak ada posting yang terlambat terbit." },
  ];
}

interface Diagnosis {
  tone: Tone;
  title: string;
  body: string;
  checks: Check[];
  /** ISO tick yang menjadi dasar pemeriksaan konfigurasi; null bila belum ada tick tanpa galat. */
  basisAt: string | null;
}

/** Status penjadwal dan pemeriksaan konfigurasi, diturunkan dari riwayat tick dan keadaan server saat data dibuat. */
function diagnose(health: HealthResponse): Diagnosis {
  const { runs } = health;
  const now = Date.parse(health.serverNow);
  const last = runs[0];
  if (!last) {
    return {
      tone: "warning",
      title: "Penjadwal belum pernah berjalan.",
      body: "Autopilot baru bekerja setelah penjadwal memanggil tick tiap 5 menit. Minta pemilik dashboard memeriksa cron di server.",
      checks: [],
      basisAt: null,
    };
  }

  // Dua-duanya jam server, jadi jam perangkat yang meleset tidak membuat penjadwal tampak mati.
  const age = Number.isFinite(now) ? Math.max(0, now - Date.parse(last.startedAt)) : 0;
  const stale = age > health.staleAfterMs;
  const basis = runs.find((r) => !r.error) ?? null;
  const checks: Check[] = [
    stale
      ? { label: "Penjadwal", tone: "warning", detail: `Tick terakhir ${durationText(age)} lalu. Seharusnya berjalan tiap 5 menit.` }
      : { label: "Penjadwal", tone: "success", detail: `Aktif. Tick terakhir ${durationText(age)} lalu.` },
    ...(basis ? configChecks(basis, health.publishEnabled) : []),
  ];
  const rest = { checks, basisAt: basis?.startedAt ?? null };

  if (stale) {
    return {
      tone: "warning",
      title: `Penjadwal berhenti: tick terakhir ${durationText(age)} lalu.`,
      body: "Autopilot tidak menulis atau menjadwalkan apa pun sampai penjadwal aktif lagi.",
      ...rest,
    };
  }
  if (last.error) return { tone: "danger", title: "Tick terakhir berakhir dengan galat.", body: last.error, ...rest };
  return {
    tone: "success",
    title: "Penjadwal berjalan normal.",
    body: `Tick terakhir ${durationText(age)} lalu, selesai dalam ${formatMs(last.durasiMs)}.`,
    ...rest,
  };
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="card p-3.5">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={cn("mt-0.5 text-xl font-bold tabular-nums", tone === "danger" ? "text-danger" : "text-fg")}>{value}</p>
    </div>
  );
}

function RunRow({ run }: { run: HealthRunDTO }) {
  const entries = Object.entries(run.hitung).filter(([, n]) => n > 0);
  const trouble = entries.some(([key]) => TROUBLE_KEYS.has(key));
  return (
    <li className="p-4 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-bold text-fg tabular-nums">
          <time dateTime={run.startedAt}>{formatWibFull(new Date(run.startedAt))}</time>
          <span className="font-medium text-muted"> · {formatMs(run.durasiMs)}</span>
        </p>
        <Pill tone={run.error ? "danger" : trouble ? "warning" : "success"}>
          {run.error ? "Galat" : trouble ? "Selesai dengan catatan" : "Berhasil"}
        </Pill>
      </div>
      <p className="text-[13px] text-muted break-words">
        {entries.length === 0
          ? "Tidak ada yang perlu dikerjakan."
          : entries.map(([key, n]) => FLAG_LABEL[key] ?? `${formatInt(n)} ${COUNT_LABEL[key] ?? humanize(key)}`).join(" · ")}
      </p>
      {run.error && <p className="text-[13px] font-medium text-danger break-words">{run.error}</p>}
    </li>
  );
}

/** Status penjadwal (tick), ringkasan 24 jam, pemeriksaan konfigurasi, dan riwayat tick. Khusus Admin ke atas. */
function SchedulerPanel() {
  const { data, error, status, loading, refreshing, reload } = useRemote<HealthResponse>("kesehatan", fetchAutopilotHealth, LOAD_ERROR);
  const [allRuns, setAllRuns] = useState(false);

  if (loading) return <ListSkeleton label="Memuat kesehatan autopilot" rows={3} />;
  if (!data) return <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />;
  if (!data.installed) return <NotInstalled title="Autopilot belum dipasang." file="sql/005_autopilot.sql" />;

  const { tone, title, body, checks, basisAt } = diagnose(data);
  const day = data.last24h;
  const runs = allRuns ? data.runs : data.runs.slice(0, RUNS_SHOWN);

  return (
    <div className="space-y-4">
      {error && (
        <Banner tone="danger">
          Gagal menyegarkan data: {error}{" "}
          <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
            Coba lagi
          </button>
        </Banner>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted max-w-xl">Penjadwal memanggil autopilot tiap 5 menit untuk merencanakan, menulis, dan mengantrekan posting.</p>
        <div className="ml-auto">
          <RefreshButton onClick={reload} busy={refreshing} />
        </div>
      </div>

      <Banner tone={tone}>
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 break-words">{body}</p>
      </Banner>

      <section aria-label="Ringkasan 24 jam terakhir" className="space-y-2">
        <h4 className="text-sm font-bold text-fg">24 jam terakhir</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Tick" value={formatInt(day.ticks)} />
          <Tile label="Tick galat" value={formatInt(day.errors)} tone={day.errors > 0 ? "danger" : undefined} />
          <Tile label="Putaran AI" value={formatInt(day.putaranAi)} />
          <Tile label="Diantrekan" value={formatInt(day.diantre)} />
          <Tile label="Dilewati" value={formatInt(day.dilewati)} />
          <Tile label="Rata-rata durasi" value={day.ticks > 0 ? formatMs(day.avgMs) : "-"} />
        </div>
      </section>

      {checks.length > 0 && (
        <section aria-label="Pemeriksaan konfigurasi" className="card p-4">
          <h4 className="text-sm font-bold text-fg">Pemeriksaan konfigurasi</h4>
          <p className="text-xs text-muted">
            {basisAt
              ? `Menurut tick tanpa galat terakhir (${formatWibFull(new Date(basisAt))}).`
              : "Belum ada tick tanpa galat, jadi hanya penjadwal yang bisa diperiksa."}
          </p>
          <ul className="mt-2 divide-y divide-line">
            {checks.map((c) => {
              const { Icon, cls } = TONE_ICON[c.tone];
              return (
                <li key={c.label} className="py-2.5 flex items-start gap-2.5">
                  <Icon className={cn("w-[18px] h-[18px] mt-0.5 shrink-0", cls)} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-fg">{c.label}</p>
                    <p className="text-[13px] text-muted break-words">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Riwayat tick" className="space-y-2">
        <h4 className="text-sm font-bold text-fg">Riwayat tick</h4>
        {data.runs.length === 0 ? (
          <EmptyState icon={<HeartPulse className="w-6 h-6" />} title="Belum ada tick yang tercatat.">
            Riwayat muncul setelah penjadwal memanggil autopilot untuk pertama kali.
          </EmptyState>
        ) : (
          <>
            <ul className="card divide-y divide-line">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
            {data.runs.length > RUNS_SHOWN && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setAllRuns((v) => !v)}
                  aria-expanded={allRuns}
                  className="h-10 px-4 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
                >
                  {allRuns ? "Ringkas" : `Tampilkan semua (${data.runs.length})`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

type View = "penjadwal" | "belajar";
const VIEW_OPTIONS: SegmentedOption<View>[] = [
  { value: "penjadwal", label: "Penjadwal" },
  { value: "belajar", label: "Hasil belajar" },
];

/**
 * Tab Kesehatan: status penjadwal autopilot (Admin ke atas) dan hasil belajar (semua peran). Tiap
 * bagian baru memuat datanya saat pertama kali dibuka.
 */
export function HealthTab({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<View>("penjadwal");
  if (!isAdmin) return <PerformancePanel />;

  return (
    <div className="space-y-4">
      <Segmented ariaLabel="Bagian kesehatan" options={VIEW_OPTIONS} value={view} onChange={setView} className="sm:max-w-sm" />
      <Activity mode={view === "penjadwal" ? "visible" : "hidden"}>
        <SchedulerPanel />
      </Activity>
      <Activity mode={view === "belajar" ? "visible" : "hidden"}>
        <PerformancePanel />
      </Activity>
    </div>
  );
}
