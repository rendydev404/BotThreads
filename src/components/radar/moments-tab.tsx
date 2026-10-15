"use client";

import React, { useId, useLayoutEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, Pencil, Repeat, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteMoment, listMoments } from "@/lib/radar-client";
import type { MomentDTO, MomentListResponse } from "@/lib/radar-types";
import { wibDayKey } from "@/lib/scheduling";
import { ConfirmModal } from "@/components/autopilot/confirm-modal";
import { Banner, ListSkeleton } from "@/components/autopilot/shared";
import { errorStatus, errorText, formatDayRange } from "@/components/settings/format";
import { useRemote } from "@/components/settings/use-remote";
import { builtinMoments, dayDiff, momentPhase, type MomentPhase } from "./moment-dates";
import { MomentModal, type MomentEditor } from "./moment-modal";
import { BTN, BTN_PRIMARY, EmptyState, ICON_BTN, LoadFailure, NotInstalled, RefreshButton, useNotice } from "./shared";

const PHASE_CLASS: Record<MomentPhase, string> = {
  berjalan: "bg-success-soft text-success",
  mendatang: "bg-accent-soft text-accent",
  lewat: "bg-subtle text-muted",
};

function PhaseChip({ today, mulai, selesai }: { today: string; mulai: string; selesai: string }) {
  const { phase, label } = momentPhase(today, mulai, selesai);
  return (
    <span className={cn("inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap", PHASE_CLASS[phase])}>
      {label}
    </span>
  );
}

/** "14 - 20 Okt 2026 · 7 hari" */
function rangeText(mulai: string, selesai: string): string {
  const span = dayDiff(mulai, selesai);
  return span === null ? formatDayRange(mulai, selesai) : `${formatDayRange(mulai, selesai)} · ${span + 1} hari`;
}

/** Urutan yang sama dengan server: tanggal mulai, lalu id. */
const byStart = (a: MomentDTO, b: MomentDTO): number => a.mulai.localeCompare(b.mulai) || a.id.localeCompare(b.id);

interface MomentsTabProps {
  /** Editor ke atas (peran minimal semua route ubah momen). */
  canEdit: boolean;
  onForbidden: () => void;
}

export function MomentsTab({ canEdit, onForbidden }: MomentsTabProps) {
  const remote = useRemote<MomentListResponse>("moments", (signal) => listMoments(signal), "Gagal memuat kalender momen.");
  const { data, mutate, reload } = remote;
  const [editor, setEditor] = useState<MomentEditor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MomentDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { notice, show: showNotice, clear: clearNotice } = useNotice();
  const customId = useId();
  const builtinId = useId();

  // Tab atau halaman yang disembunyikan tidak boleh kembali dengan dialog masih terbuka.
  useLayoutEffect(
    () => () => {
      setEditor(null);
      setDeleteTarget(null);
    },
    []
  );

  // "Hari ini" (WIB) mengikuti saat data diterima, bukan jam saat render.
  const today = remote.loadedAt !== null ? wibDayKey(new Date(remote.loadedAt)) : null;
  const builtin = useMemo(() => (today ? builtinMoments(today) : []), [today]);
  const editable = canEdit && data?.installed === true;

  const openEditor = (moment: MomentDTO | null) => {
    const now = Date.now();
    setEditor({ token: now, today: wibDayKey(new Date(now)), moment });
  };

  const removeLocal = (id: string) => mutate((d) => ({ ...d, items: d.items.filter((m) => m.id !== id) }));

  /** Simpan berhasil: sisipkan atau ganti baris secara lokal, tanpa memuat ulang daftar. */
  const onSaved = (saved: MomentDTO, created: boolean) => {
    mutate((d) => ({ ...d, items: [...d.items.filter((m) => m.id !== saved.id), saved].sort(byStart) }));
    setEditor(null);
    showNotice("success", created ? `Momen "${saved.nama}" ditambahkan.` : `Momen "${saved.nama}" diperbarui.`);
  };

  const onGone = (moment: MomentDTO) => {
    removeLocal(moment.id);
    setEditor(null);
    showNotice("info", `Momen "${moment.nama}" sudah dihapus sebelumnya.`);
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMoment(target.id);
      removeLocal(target.id);
      setDeleteTarget(null);
      showNotice("success", `Momen "${target.nama}" dihapus.`);
    } catch (e) {
      const status = errorStatus(e);
      if (status === 404) {
        removeLocal(target.id);
        setDeleteTarget(null);
        showNotice("info", `Momen "${target.nama}" sudah dihapus sebelumnya.`);
      } else {
        if (status === 403) onForbidden();
        setDeleteError(errorText(e, "Gagal menghapus momen. Coba lagi."));
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <p className="text-sm text-muted">
          Tanggal penting yang ikut dipertimbangkan AI. Momen yang sedang berjalan atau segera dimulai menjadi sinyal radar.
        </p>
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <RefreshButton onClick={reload} busy={remote.refreshing} disabled={remote.loading} />
          {editable && (
            <button type="button" onClick={() => openEditor(null)} className={cn(BTN, BTN_PRIMARY)}>
              <CalendarPlus className="w-4 h-4" />
              Tambah momen
            </button>
          )}
        </div>
      </div>

      {notice && (
        <Banner tone={notice.tone} onClose={clearNotice}>
          {notice.text}
        </Banner>
      )}

      {remote.loading ? (
        <ListSkeleton label="Memuat kalender momen" />
      ) : !data ? (
        <LoadFailure status={remote.status} message={remote.error ?? "Gagal memuat kalender momen."} onRetry={reload} />
      ) : !data.installed ? (
        <NotInstalled />
      ) : (
        <>
          {remote.error && <Banner tone="danger">Gagal menyegarkan: {remote.error}</Banner>}

          <section aria-labelledby={customId} className="space-y-2.5">
            <h3 id={customId} className="text-sm font-bold text-fg">
              Momen Anda
              {data.items.length > 0 && <span className="ml-1.5 font-semibold text-muted tabular-nums">{data.items.length}</span>}
            </h3>
            {data.items.length === 0 ? (
              <EmptyState icon={<CalendarDays className="w-6 h-6" />} title="Belum ada momen khusus.">
                <p>
                  Tambahkan tanggal penting brand Anda, misalnya ulang tahun outlet, promo musiman, atau hari besar. AI
                  ikut memakainya sebagai bahan ide saat momennya dekat.
                </p>
                {!canEdit && <p>Menambah momen butuh peran Editor ke atas.</p>}
              </EmptyState>
            ) : (
              <ul className="card divide-y divide-line">
                {data.items.map((m) => (
                  <li key={m.id} className="p-4 flex items-start gap-3">
                    <div className="hidden sm:flex w-10 h-10 rounded-xl bg-accent-soft text-accent items-center justify-center shrink-0">
                      <CalendarDays className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="min-w-0 text-sm font-semibold text-fg break-words">{m.nama}</p>
                        {today && <PhaseChip today={today} mulai={m.mulai} selesai={m.selesai} />}
                      </div>
                      <p className="mt-0.5 text-[13px] font-medium text-muted tabular-nums">{rangeText(m.mulai, m.selesai)}</p>
                      {m.catatan && <p className="mt-1.5 text-[13px] text-muted leading-relaxed break-words">{m.catatan}</p>}
                    </div>
                    {editable && (
                      <div className="flex shrink-0 -mr-2 -mt-1.5">
                        <button
                          type="button"
                          onClick={() => openEditor(m)}
                          aria-label={`Ubah momen ${m.nama}`}
                          className={cn(ICON_BTN, "hover:text-accent hover:bg-accent-soft")}
                        >
                          <Pencil className="w-[18px] h-[18px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(m);
                          }}
                          aria-label={`Hapus momen ${m.nama}`}
                          className={cn(ICON_BTN, "hover:text-danger hover:bg-danger-soft")}
                        >
                          <Trash2 className="w-[18px] h-[18px]" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={builtinId} className="space-y-2.5">
            <div>
              <h3 id={builtinId} className="text-sm font-bold text-fg">
                Momen bawaan
              </h3>
              <p className="mt-0.5 text-[13px] text-muted">
                Berulang otomatis dan tidak bisa diubah. Menjadi sinyal radar pada hari-hari berlakunya.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {builtin.map((b) => (
                <li key={b.key} className="card p-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold text-fg">{b.nama}</p>
                    {today && <PhaseChip today={today} mulai={b.mulai} selesai={b.selesai} />}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-muted">
                    <Repeat className="w-3.5 h-3.5 shrink-0" />
                    {b.aturan}
                  </p>
                  <p className="mt-0.5 text-[13px] font-medium text-muted tabular-nums">{rangeText(b.mulai, b.selesai)}</p>
                  <p className="mt-1.5 text-[13px] text-muted leading-relaxed">{b.catatan}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <MomentModal editor={editor} onClose={() => setEditor(null)} onSaved={onSaved} onGone={onGone} onForbidden={onForbidden} />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        busy={deleting}
        error={deleteError}
        variant="danger"
        title="Hapus momen ini?"
        confirmLabel="Ya, hapus"
        confirmIcon={<Trash2 className="w-4 h-4" />}
      >
        {deleteTarget && (
          <p className="text-sm text-fg leading-relaxed">
            Momen <span className="font-semibold break-words">{deleteTarget.nama}</span> ({formatDayRange(deleteTarget.mulai, deleteTarget.selesai)})
            dihapus dari kalender, dan sinyalnya ikut dihapus dari radar.
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
