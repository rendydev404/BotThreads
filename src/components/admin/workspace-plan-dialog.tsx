"use client";

import React, { useId, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { setWorkspacePlan } from "@/lib/admin-client";
import type { AdminWorkspaceDTO } from "@/lib/admin-types";
import { formatRupiah, type PlanDTO } from "@/lib/plan-types";
import { wibDayKey } from "@/lib/scheduling";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Dropdown, type DropdownOption } from "@/components/autopilot/dropdown";
import { Banner } from "@/components/autopilot/shared";
import { DayField, addDays, dayDiff } from "@/components/settings/day-field";
import { ControlLabel, FormError } from "@/components/settings/fields";
import { daysInMonth, errorText, formatDayKey, parseDayKey, toDayKey } from "@/components/settings/format";
import { useAdmin } from "./shared";

/** Nilai dropdown untuk "ikuti paket bawaan" (kode paket tidak pernah kosong). */
const FOLLOW_DEFAULT = "";

type Term = "none" | "30" | "90" | "365" | "custom";
const TERMS: { value: Term; label: string }[] = [
  { value: "none", label: "Tanpa batas waktu" },
  { value: "30", label: "30 hari" },
  { value: "90", label: "90 hari" },
  { value: "365", label: "1 tahun" },
  { value: "custom", label: "Pilih tanggal" },
];

/** Tanggal yang sama tahun depan (29 Feb menjadi 28 Feb). */
function addYear(key: string): string {
  const p = parseDayKey(key);
  return p ? toDayKey(p.y + 1, p.m, Math.min(p.d, daysInMonth(p.y + 1, p.m))) : key;
}

/** Akhir hari itu di WIB (23.59.59 +07:00) sebagai ISO UTC. */
const endOfWibDay = (dayKey: string): string => new Date(`${dayKey}T23:59:59+07:00`).toISOString();

const planHint = (p: PlanDTO): string =>
  `${formatRupiah(p.hargaBulanan)}${p.hargaBulanan > 0 ? " per bulan" : ""} · ${p.maxAkun} akun · ${p.maxPostingPerHari} posting per hari · ${p.maxAnggota} anggota`;

interface WorkspacePlanDialogProps {
  workspace: AdminWorkspaceDTO;
  /** Semua paket (daftar bersama dari halaman). */
  plans: PlanDTO[];
  /** Hari ini (WIB) saat dialog dibuka, "YYYY-MM-DD". */
  today: string;
  onClose: () => void;
  onSaved: (planId: string | null, until: string | null) => void;
}

/** Pasang paket dan masa berlakunya ke satu workspace (dilakukan setelah pembayaran diterima). */
export function WorkspacePlanDialog({ workspace, plans, today, onClose, onSaved }: WorkspacePlanDialogProps) {
  const { guard } = useAdmin();
  const currentDay = workspace.planId && workspace.planBerakhir ? wibDayKey(new Date(workspace.planBerakhir)) : null;
  const [planId, setPlanId] = useState<string>(workspace.planId ?? FOLLOW_DEFAULT);
  // Paket yang sudah terpasang membuka tanggalnya sendiri; pemasangan baru mulai dari 30 hari (harga paket per bulan).
  const [term, setTerm] = useState<Term>(workspace.planId ? (currentDay ? "custom" : "none") : "30");
  const [customDay, setCustomDay] = useState<string>(currentDay ?? addDays(today, 30));
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();

  const fallback = plans.find((p) => p.bawaan) ?? null;
  const options = useMemo<DropdownOption<string>[]>(
    () => [
      {
        value: FOLLOW_DEFAULT,
        label: "Ikuti paket bawaan",
        hint: fallback ? `Saat ini ${fallback.nama}` : "Belum ada paket bawaan, jadi tanpa batas",
      },
      // Paket nonaktif hanya ikut ditawarkan bila memang sedang terpasang di workspace ini.
      ...plans
        .filter((p) => p.aktif || p.id === workspace.planId)
        .map((p) => ({ value: p.id, label: p.aktif ? p.nama : `${p.nama} (nonaktif)`, hint: planHint(p) })),
      // Paket terpasang yang sudah tidak ada di daftar tetap tampil supaya pilihan sekarang terbaca.
      ...(workspace.planId && !plans.some((p) => p.id === workspace.planId)
        ? [{ value: workspace.planId, label: workspace.planId, hint: "Paket ini tidak ada lagi di daftar" }]
        : []),
    ],
    [plans, fallback, workspace.planId]
  );

  const own = planId !== FOLLOW_DEFAULT;
  const picked = plans.find((p) => p.id === planId) ?? null;
  const day = !own || term === "none" ? null : term === "custom" ? customDay : term === "365" ? addYear(today) : addDays(today, Number(term));
  const left = day ? dayDiff(today, day) : null;
  const dayError = day && left !== null && left < 0 ? "Tanggal berakhir sudah lewat. Pilih hari ini atau sesudahnya." : null;
  const nextPlan = own ? planId : null;
  const until = day ? endOfWibDay(day) : null;
  // Tanggal yang tidak disentuh dikirim apa adanya, supaya jam berakhirnya tidak bergeser.
  const keepsUntil = term === "custom" && day === currentDay && nextPlan === workspace.planId;
  const sendUntil = keepsUntil ? workspace.planBerakhir : until;
  const unchanged = nextPlan === workspace.planId && sendUntil === (workspace.planId ? workspace.planBerakhir : null);

  const submit = async () => {
    setSubmitted(true);
    if (busy || dayError) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await guard(setWorkspacePlan(workspace.id, nextPlan, sendUntil));
      onSaved(nextPlan, nextPlan ? sendUntil : null);
    } catch (e) {
      setFailure(errorText(e, "Gagal memasang paket. Coba lagi."));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title="Atur paket workspace"
      description={`Workspace ${workspace.nama}`}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" type="submit" form={formId} disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? "Menyimpan..." : "Pasang paket"}
          </ModalButton>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-5"
      >
        <div>
          <ControlLabel hint="Pembayaran tidak otomatis: pasang paket setelah pembayaran diterima.">Paket</ControlLabel>
          <Dropdown
            ariaLabel="Paket"
            value={planId}
            options={options}
            onChange={(next) => {
              setPlanId(next);
              setFailure(null);
            }}
            disabled={busy}
          />
          {picked && <p className="mt-1.5 text-xs text-muted leading-relaxed">{planHint(picked)}</p>}
        </div>

        {own && (
          <div>
            <ControlLabel hint="Paket berakhir pada akhir hari yang dipilih (23.59 WIB).">Berlaku sampai</ControlLabel>
            <div role="group" aria-label="Masa berlaku" className="flex flex-wrap gap-2">
              {TERMS.map((t) => {
                const active = term === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => {
                      setTerm(t.value);
                      setFailure(null);
                    }}
                    className={cn(
                      "h-10 px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                      active ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong text-fg hover:border-accent hover:text-accent"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {term === "custom" && (
              <div className="mt-3">
                <DayField label="Tanggal berakhir" value={customDay} onChange={setCustomDay} today={today} disabled={busy} />
              </div>
            )}
            {submitted && dayError ? (
              <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                {dayError}
              </p>
            ) : (
              <p role="status" aria-live="polite" className="mt-1.5 text-xs text-muted">
                {day
                  ? `Berakhir ${formatDayKey(day)}${left === null ? "" : left < 0 ? " (sudah lewat)" : left === 0 ? " (hari ini)" : ` (${left} hari lagi)`}.`
                  : "Tidak ada tanggal berakhir."}
              </p>
            )}
          </div>
        )}

        <Banner tone={own && day ? "warning" : "info"}>
          {!own
            ? `Workspace ini mengikuti paket bawaan platform (${fallback ? fallback.nama : "belum ada, jadi tanpa batas"}) dan tidak punya masa berlaku sendiri.`
            : day
              ? `Saat paket berakhir pada ${formatDayKey(day)}, autopilot workspace ini berhenti sampai masa berlakunya diperpanjang. Datanya tetap bisa dibuka.`
              : "Tanpa tanggal berakhir, paket berlaku terus sampai diubah dari sini. Bila nanti diberi tanggal dan terlewat, autopilot workspace ini berhenti sampai diperpanjang."}
        </Banner>

        <FormError message={failure} />
      </form>
    </ModalShell>
  );
}
