"use client";

import React, { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveMoment } from "@/lib/radar-client";
import { MOMENT_MAX_SPAN_DAYS, MOMENT_NAME_MAX, MOMENT_NOTE_MAX, type MomentDTO } from "@/lib/radar-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { FormError, TextAreaField, TextField } from "@/components/settings/fields";
import { errorDetails, errorStatus, errorText, formatDayRange } from "@/components/settings/format";
import { DayPicker } from "./day-picker";
import { dayDiff } from "./moment-dates";

/** Satu sesi buka dialog. `today` dikunci saat tombol ditekan supaya render tidak membaca jam. */
export interface MomentEditor {
  /** Pembeda tiap kali dialog dibuka (kunci React), supaya isian selalu mulai dari awal. */
  token: number;
  /** Hari ini (WIB), "YYYY-MM-DD". */
  today: string;
  /** null = momen baru. */
  moment: MomentDTO | null;
}

interface DialogProps {
  editor: MomentEditor;
  onClose: () => void;
  /** Tersimpan di server; `created` = momen baru. Daftar diperbarui secara lokal oleh pemanggil. */
  onSaved: (moment: MomentDTO, created: boolean) => void;
  /** Momen yang diubah ternyata sudah tidak ada di server. */
  onGone: (moment: MomentDTO) => void;
  /** Server menolak karena peran (403): profil perlu dimuat ulang. */
  onForbidden: () => void;
}

/** Rapikan nama seperti server (radar-service.ts): tanpa kurung sudut, spasi dirapatkan. */
const cleanName = (raw: string): string => raw.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();

function MomentDialog({ editor, onClose, onSaved, onGone, onForbidden }: DialogProps) {
  const { moment, today } = editor;
  const [nama, setNama] = useState(moment?.nama ?? "");
  const [mulai, setMulai] = useState(moment?.mulai ?? today);
  const [selesai, setSelesai] = useState(moment?.selesai ?? today);
  const [catatan, setCatatan] = useState(moment?.catatan ?? "");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  const baseYear = Number(today.slice(0, 4));
  // Tahun lalu ikut ditawarkan: momen boleh sudah mulai asalkan belum selesai.
  const years = [baseYear - 1, baseYear, baseYear + 1, baseYear + 2];

  const name = cleanName(nama);
  const nameIssue = name.length < 2 || name.length > MOMENT_NAME_MAX ? `Nama momen harus 2-${MOMENT_NAME_MAX} karakter.` : null;

  // Aturan yang sama dengan server, supaya kesalahan terlihat sebelum dikirim.
  const span = dayDiff(mulai, selesai);
  const dateIssue =
    span === null
      ? "Tanggal momen tidak valid."
      : span < 0
        ? "Tanggal selesai tidak boleh sebelum tanggal mulai."
        : span > MOMENT_MAX_SPAN_DAYS
          ? `Rentang momen paling lama ${MOMENT_MAX_SPAN_DAYS} hari.`
          : selesai < today
            ? "Tanggal selesai sudah lewat. Pilih hari ini atau sesudahnya."
            : null;

  const changeStart = (next: string) => {
    setMulai(next);
    if (next > selesai) setSelesai(next);
    setError(null);
  };
  const changeEnd = (next: string) => {
    setSelesai(next);
    if (next < mulai) setMulai(next);
    setError(null);
  };

  const submit = async () => {
    if (saving) return;
    if (nameIssue || dateIssue) {
      setTried(true);
      return;
    }
    const note = catatan.replace(/\s+/g, " ").trim() || null;
    setSaving(true);
    setError(null);
    try {
      const res = await saveMoment({ ...(moment ? { id: moment.id } : {}), nama: name, mulai, selesai, catatan: note });
      // Baris lokal memakai balasan server (nama dan catatan sudah dirapikan di sana).
      onSaved(res.moment, !moment);
    } catch (e) {
      const status = errorStatus(e);
      if (status === 404 && moment) {
        onGone(moment);
        return;
      }
      if (status === 403) onForbidden();
      setError({ message: errorText(e, "Gagal menyimpan momen. Coba lagi."), details: errorDetails(e) });
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={saving}
      title={moment ? "Ubah momen" : "Tambah momen"}
      description="Tanggal penting yang ikut dipertimbangkan AI saat menyusun ide."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={saving}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={() => void submit()} disabled={saving || !!dateIssue}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Menyimpan..." : "Simpan"}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="Nama momen"
          value={nama}
          onChange={(v) => {
            setNama(v);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit();
          }}
          maxLength={MOMENT_NAME_MAX}
          showCount
          placeholder="Contoh: Ulang tahun outlet"
          autoComplete="off"
          disabled={saving}
          error={tried ? nameIssue : null}
          data-autofocus
        />
        <DayPicker label="Mulai" value={mulai} onChange={changeStart} years={years} disabled={saving} />
        <DayPicker label="Selesai" value={selesai} onChange={changeEnd} years={years} disabled={saving} />
        <p role={dateIssue ? "alert" : undefined} className={cn("text-[13px] font-medium", dateIssue ? "text-danger" : "text-muted")}>
          {dateIssue ?? `Berlaku ${formatDayRange(mulai, selesai)} (${(span ?? 0) + 1} hari).`}
        </p>
        <TextAreaField
          label="Catatan (opsional)"
          value={catatan}
          onChange={(v) => {
            setCatatan(v);
            setError(null);
          }}
          maxLength={MOMENT_NOTE_MAX}
          rows={3}
          placeholder="Contoh: promo beli 2 gratis 1, tonjolkan suasana kumpul keluarga"
          hint="Ikut dibaca AI sebagai konteks momen."
          disabled={saving}
        />
        <FormError message={error?.message} details={error?.details} />
      </div>
    </ModalShell>
  );
}

/** Dialog tambah/ubah momen kalender. `editor = null` berarti tertutup. */
export function MomentModal({ editor, ...rest }: Omit<DialogProps, "editor"> & { editor: MomentEditor | null }) {
  if (!editor) return null;
  return <MomentDialog key={editor.token} editor={editor} {...rest} />;
}
