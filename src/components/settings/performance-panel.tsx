"use client";

import React, { useMemo, useState } from "react";
import { Flame, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchPerformance } from "@/lib/notification-client";
import { PERFORMANCE_DIM_LABEL, type PerformanceDimKey, type PerformanceResponse } from "@/lib/notification-types";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Banner, ListSkeleton, accountHandle } from "@/components/autopilot/shared";
import { formatDateWib, formatInt, formatMultiplier } from "./format";
import { EmptyState, LoadError, NotInstalled, RefreshButton } from "./states";
import { useRemote } from "./use-remote";

const LOAD_ERROR = "Gagal memuat hasil belajar autopilot.";
const DIM_ORDER: PerformanceDimKey[] = ["formulaHook", "pilar", "jam", "jenisSlot"];
const DIM_HINT: Record<PerformanceDimKey, string> = {
  formulaHook: "Cara membuka posting yang paling memancing views.",
  pilar: "Tema konten yang paling disukai audiens.",
  jam: "Jam tayang (WIB) dengan hasil terbaik.",
  jenisSlot: "Asal jam tayang: jam ramai, eksplorasi, jam tetap, atau tren.",
};
/** Baris per kategori sebelum "Tampilkan semua". */
const TOP_ROWS = 5;
/** Di bawah jumlah posting ini angkanya belum bisa dipegang. */
const THIN_SAMPLE = 3;

type Dim = PerformanceResponse["dims"][number];

/** Satu kategori sebagai batang berperingkat. Garis tegak menandai 1x (seperti kebiasaan akun). */
function DimCard({ dim, rows }: { dim: PerformanceDimKey; rows: Dim[] }) {
  const [all, setAll] = useState(false);
  // Skala minimal 2x supaya garis 1x tidak menempel di ujung kanan.
  const scale = Math.max(2, ...rows.map((r) => r.multiplier));
  const visible = all ? rows : rows.slice(0, TOP_ROWS);

  return (
    <section aria-label={PERFORMANCE_DIM_LABEL[dim]} className="card p-4">
      <h4 className="text-sm font-bold text-fg">{PERFORMANCE_DIM_LABEL[dim]}</h4>
      <p className="text-xs text-muted">{DIM_HINT[dim]}</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Belum ada data untuk kategori ini.</p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {visible.map((r, i) => {
            const thin = r.n < THIN_SAMPLE;
            return (
              <li key={r.val}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[13px] font-semibold text-fg truncate">
                    <span className="text-faint tabular-nums">{i + 1}.</span> {r.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    <span className={cn("text-[13px] font-bold", r.multiplier >= 1 ? "text-accent" : "text-fg")}>
                      {formatMultiplier(r.multiplier)}
                    </span>
                    {" · "}
                    {formatInt(r.n)} posting
                  </span>
                </div>
                <div className="relative mt-1 h-2 rounded-full bg-subtle overflow-hidden" aria-hidden>
                  <div
                    className={cn("bar-grow origin-left h-full rounded-full", r.multiplier >= 1 ? "bg-accent" : "bg-faint", thin && "opacity-50")}
                    style={{ width: `${Math.max(2, Math.min(100, (r.multiplier / scale) * 100))}%` }}
                  />
                  <span className="absolute inset-y-0 w-0.5 bg-fg/40" style={{ left: `${(1 / scale) * 100}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-faint">
                  Rata-rata {formatInt(r.avgViews)} views{thin ? " · data masih sedikit" : ""}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {rows.length > TOP_ROWS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="-mb-2 mt-1 h-10 inline-flex items-center text-[13px] font-semibold text-accent hover:underline cursor-pointer"
        >
          {all ? "Ringkas" : `Tampilkan semua (${rows.length})`}
        </button>
      )}
    </section>
  );
}

/** Posting autopilot dibanding posting lain pada akun yang sama (30 hari). */
function CompareCard({ data }: { data: PerformanceResponse }) {
  const rows = [
    { key: "autopilot", label: "Posting autopilot", ...data.autopilot, bar: "bg-accent" },
    { key: "lainnya", label: "Posting lain", ...data.lainnya, bar: "bg-faint" },
  ];
  const max = Math.max(1, data.autopilot.avgViews, data.lainnya.avgViews);
  const ratio = data.autopilot.n > 0 && data.lainnya.n > 0 && data.lainnya.avgViews > 0 ? data.autopilot.avgViews / data.lainnya.avgViews : null;

  return (
    <section aria-label="Autopilot dibanding posting lain" className="card p-4">
      <h4 className="text-sm font-bold text-fg">Autopilot dibanding posting lain</h4>
      <p className="text-xs text-muted">Rata-rata views per posting pada akun yang sama, 30 hari terakhir.</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-semibold text-fg">{r.label}</span>
              <span className="text-xs text-muted tabular-nums">
                <span className="text-[13px] font-bold text-fg">{r.n > 0 ? formatInt(r.avgViews) : "-"}</span> views · {formatInt(r.n)} posting
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-subtle overflow-hidden" aria-hidden>
              <div
                className={cn("bar-grow origin-left h-full rounded-full", r.bar)}
                style={{ width: `${r.n > 0 ? Math.max(2, (r.avgViews / max) * 100) : 0}%` }}
              />
            </div>
            {r.n > 0 && <p className="mt-0.5 text-xs text-faint">Nilai tengah {formatInt(r.medianViews)} views</p>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-muted">
        {data.autopilot.n === 0
          ? "Belum ada posting autopilot yang cukup umur (minimal satu hari) untuk dibandingkan."
          : ratio === null
            ? "Belum ada posting lain pada akun yang sama untuk dibandingkan."
            : `Posting autopilot mendapat ${formatMultiplier(ratio)} views posting lain.`}
      </p>
    </section>
  );
}

/** Hasil belajar autopilot 60 hari: kategori mana yang berhasil, dengan filter akun opsional. */
export function PerformancePanel() {
  const accounts = usePublishAccounts();
  /** "" = semua akun dalam lingkup pengguna. */
  const [accountId, setAccountId] = useState("");
  const { data, error, status, loading, refreshing, reload } = useRemote<PerformanceResponse>(
    `performa:${accountId || "semua"}`,
    (signal) => fetchPerformance(accountId || null, signal),
    LOAD_ERROR
  );

  const accountOptions = useMemo<DropdownOption<string>[]>(
    () => [
      { value: "", label: "Semua akun" },
      ...accounts.accounts.map((a) => ({ value: a.id, label: accountHandle(a), hint: a.outletNama ?? a.displayName })),
    ],
    [accounts.accounts]
  );

  const groups = useMemo(() => {
    const by = new Map<PerformanceDimKey, Dim[]>(DIM_ORDER.map((d) => [d, []]));
    for (const row of data?.dims ?? []) by.get(row.dim)?.push(row);
    for (const rows of by.values()) rows.sort((a, b) => b.multiplier - a.multiplier || b.n - a.n);
    return by;
  }, [data?.dims]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <p className="text-sm text-muted max-w-xl">
          Yang dipelajari autopilot dari 60 hari terakhir. 1,0x berarti seperti kebiasaan akun; di atas itu lebih baik.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Dropdown
            ariaLabel="Akun"
            value={accountId}
            options={accountOptions}
            onChange={setAccountId}
            disabled={accounts.loading}
            align="right"
            className="flex-1 sm:flex-none sm:w-56 min-w-0"
          />
          <RefreshButton onClick={reload} busy={refreshing} disabled={loading} />
        </div>
      </div>

      {loading ? (
        <ListSkeleton label="Memuat hasil belajar autopilot" rows={3} />
      ) : !data ? (
        <LoadError message={error ?? LOAD_ERROR} status={status} onRetry={reload} />
      ) : !data.installed ? (
        <NotInstalled title="Pembelajaran autopilot belum dipasang." file="sql/007_autopilot_learning.sql" />
      ) : data.dims.length === 0 && data.autopilot.n === 0 && data.viral.length === 0 ? (
        <EmptyState icon={<TrendingUp className="w-6 h-6" />} title="Belum ada yang bisa dipelajari.">
          Autopilot mulai belajar setelah postingannya berumur minimal satu hari dan statistiknya masuk.
        </EmptyState>
      ) : (
        <>
          {error && (
            <Banner tone="danger">
              Gagal menyegarkan data: {error}{" "}
              <button type="button" onClick={reload} className="underline font-semibold cursor-pointer">
                Coba lagi
              </button>
            </Banner>
          )}
          <CompareCard data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            {DIM_ORDER.map((dim) => (
              <DimCard key={dim} dim={dim} rows={groups.get(dim) ?? []} />
            ))}
          </div>
          {data.viral.length > 0 && (
            <section aria-label="Posting viral" className="card p-4">
              <h4 className="flex items-center gap-2 text-sm font-bold text-fg">
                <Flame className="w-4 h-4 text-warning" />
                Posting viral terbaru
              </h4>
              <p className="text-xs text-muted">Posting autopilot yang views-nya jauh di atas kebiasaan akunnya.</p>
              <ul className="mt-2 divide-y divide-line">
                {data.viral.map((v) => (
                  <li key={v.postId} className="py-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="min-w-0 text-[13px] font-semibold text-fg truncate">
                      {v.username ? `@${v.username}` : "Satu akun"} <span className="font-normal text-muted">· {formatDateWib(v.postedAt)}</span>
                    </span>
                    <span className="text-xs text-muted tabular-nums">
                      <span className="text-[13px] font-bold text-fg">{formatInt(v.views)}</span> views
                      {v.baseline > 0 ? `, ${formatMultiplier(v.views / v.baseline)} dari biasanya (${formatInt(v.baseline)})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
