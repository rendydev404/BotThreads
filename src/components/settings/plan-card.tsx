"use client";

import React from "react";
import { AlertTriangle, CreditCard, Gem, Link2 } from "lucide-react";
import { formatRupiah, type WorkspacePlanResponse } from "@/lib/plan-types";
import { fetchWorkspacePlan } from "@/lib/team-client";
import { cn } from "@/lib/utils";
import { formatDateWib } from "./format";
import { BTN_OUTLINE, BTN_PRIMARY } from "./states";
import { useRemote } from "./use-remote";
import { useT } from "@/components/i18n/lang-provider";

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  const t = useT();
  const over = used > max;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-muted">{t(label)}</span>
        <span className={cn("tabular-nums font-bold", over ? "text-danger" : "text-fg")}>
          {used} / {max}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-subtle overflow-hidden" aria-hidden="true">
        <div className={cn("h-full rounded-full", over ? "bg-danger" : "bg-accent")} style={{ width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * Paket workspace aktif dan pemakaiannya. Tidak tampil sama sekali bila workspace tidak punya paket
 * (tanpa batas) atau datanya gagal dimuat: ini informasi tambahan, bukan syarat halaman.
 */
export function PlanCard({
  onOpenSubscription,
  onOpenAccounts,
}: {
  onOpenSubscription?: () => void;
  onOpenAccounts?: () => void;
}) {
  const { data } = useRemote<WorkspacePlanResponse>("paket", fetchWorkspacePlan, "Gagal memuat paket.");
  const t = useT();
  const plan = data?.plan;
  if (!data || !plan) return null;

  return (
    <section aria-label={t("Paket workspace")} className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent flex items-center justify-center shrink-0">
            <Gem className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-fg truncate">{t("Paket {name}", { name: plan.nama })}</p>
            <p className="text-xs text-muted">
              {formatRupiah(plan.hargaBulanan)}
              {plan.hargaBulanan > 0 ? t(" per bulan") : ""} · {data.berakhir ? t("berlaku sampai {date}", { date: formatDateWib(data.berakhir) }) : t("tanpa batas waktu")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenAccounts && (
            <button type="button" onClick={onOpenAccounts} className={BTN_OUTLINE}>
              <Link2 className="w-3.5 h-3.5" />
              {t("Akun Threads")}
            </button>
          )}
          {onOpenSubscription && (
            <button type="button" onClick={onOpenSubscription} className={BTN_PRIMARY}>
              <CreditCard className="w-3.5 h-3.5" />
              {data.kedaluwarsa ? t("Perpanjang Paket") : t("Sewa / Upgrade Paket")}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">
        {t("Sampai")} <span className="font-bold text-fg">{plan.maxPostingPerHari}</span> {t("posting per akun per hari")} ·{" "}
        {plan.modeOtomatis ? t("Tinjau dulu dan Otomatis") : t("Tinjau dulu saja")}
      </p>

      {data.kedaluwarsa && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {t("Masa berlaku paket sudah habis, jadi autopilot workspace ini berhenti. Perpanjang paket di tab Langganan & Tagihan untuk mengaktifkan kembali.")}
        </p>
      )}

      <div className="mt-4 grid sm:grid-cols-2 gap-4">
        <Usage label="Akun dengan autopilot menyala" used={data.pakai.akun} max={plan.maxAkun} />
      </div>
    </section>
  );
}
