"use client";

import React, { useEffect, useId, useState } from "react";
import { Link2Off, Loader2, Trash2 } from "lucide-react";
import { deleteWorkspace, previewWorkspaceDelete } from "@/lib/admin-client";
import type { AdminWorkspaceDTO, AdminWorkspaceDeletePreview, AdminWorkspaceDeleteResult } from "@/lib/admin-types";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { Banner } from "@/components/autopilot/shared";
import { FormError, TextField } from "@/components/settings/fields";
import { errorText, formatInt } from "@/components/settings/format";
import { useAdmin } from "./shared";

interface WorkspaceDeleteDialogProps {
  workspace: AdminWorkspaceDTO;
  onClose: () => void;
  onDeleted: (result: AdminWorkspaceDeleteResult) => void;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Hapus workspace permanen. Dampaknya dimuat dulu dari server supaya admin melihat urutannya:
 * langkah 1 memutus semua akun buzzer/sumber yang tertaut (dilepas, tidak dihapus), langkah 2 menghapus.
 */
export function WorkspaceDeleteDialog({ workspace, onClose, onDeleted }: WorkspaceDeleteDialogProps) {
  const { guard } = useAdmin();
  const [preview, setPreview] = useState<AdminWorkspaceDeletePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();

  useEffect(() => {
    const ctrl = new AbortController();
    guard(previewWorkspaceDelete(workspace.id, ctrl.signal))
      .then(setPreview)
      .catch((e) => {
        if (!ctrl.signal.aborted) setLoadError(errorText(e, "Gagal memuat dampak penghapusan."));
      });
    return () => ctrl.abort();
  }, [guard, workspace.id]);

  const nama = preview?.nama ?? workspace.nama;
  const blocked = !!preview?.bagianKelompok;
  const matches = same(confirm, nama);

  const submit = async () => {
    if (busy || !preview || blocked || !matches) return;
    setBusy(true);
    setFailure(null);
    try {
      onDeleted(await guard(deleteWorkspace(workspace.id, confirm)));
    } catch (e) {
      setFailure(errorText(e, "Gagal menghapus workspace. Coba lagi."));
      setBusy(false);
    }
  };

  const linked = preview?.dilepas ?? [];
  const autopilotOff = linked.reduce((n, l) => n + l.autopilotAktif, 0);

  return (
    <ModalShell
      open
      onClose={onClose}
      busy={busy}
      title={`Hapus workspace ${nama}?`}
      description="Penghapusan permanen dan tidak bisa dibatalkan."
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="danger" type="submit" form={formId} disabled={busy || !preview || blocked || !matches}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {busy ? "Menghapus..." : "Hapus permanen"}
          </ModalButton>
        </>
      }
    >
      {!preview ? (
        loadError ? (
          <Banner tone="danger">{loadError}</Banner>
        ) : (
          <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="w-4 h-4 animate-spin" /> Menghitung dampak penghapusan...
          </div>
        )
      ) : (
        <form
          id={formId}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          {blocked && (
            <Banner tone="warning">
              Workspace ini menumpang di workspace lain. Lepaskan dulu lewat menu Sumber Akun Threads, baru bisa dihapus.
            </Banner>
          )}

          <section className="rounded-xl border border-line p-3.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <span className="w-5 h-5 rounded-full bg-subtle text-[11px] flex items-center justify-center shrink-0">1</span>
              Putus dari akun buzzer
            </h3>
            {linked.length === 0 && preview.buzzer === 0 && preview.tugasBuzzer === 0 ? (
              <p className="mt-1.5 text-[13px] text-muted leading-relaxed">Tidak ada akun buzzer atau sumber lain yang tertaut.</p>
            ) : (
              <>
                {linked.length > 0 && (
                  <>
                    <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
                      Workspace di bawah ini dilepas, <strong className="text-fg">akun Threads-nya tidak dihapus</strong>. Data
                      akunnya (Autopilot, ide konten) dipindah ke workspace asalnya.
                    </p>
                    <ul className="mt-2 divide-y divide-line rounded-lg bg-subtle px-3">
                      {linked.map((l) => (
                        <li key={l.id} className="py-2 flex items-center gap-2">
                          <Link2Off className="w-4 h-4 text-muted shrink-0" aria-hidden />
                          <span className="text-[13px] font-medium text-fg break-words min-w-0 flex-1">{l.nama}</span>
                          <span className="text-xs text-muted shrink-0 tabular-nums">{formatInt(l.akun)} akun</span>
                        </li>
                      ))}
                    </ul>
                    {autopilotOff > 0 && (
                      <p className="mt-2 text-xs text-warning leading-relaxed">
                        Autopilot {formatInt(autopilotOff)} akun di workspace itu dimatikan (sama seperti melepas tautan sumber).
                      </p>
                    )}
                  </>
                )}
                {(preview.buzzer > 0 || preview.tugasBuzzer > 0) && (
                  <p className="mt-2 text-[13px] text-muted leading-relaxed">
                    {preview.buzzer > 0 && `${formatInt(preview.buzzer)} akun workspace ini dikeluarkan dari pasukan buzzer. `}
                    {preview.tugasBuzzer > 0 && `${formatInt(preview.tugasBuzzer)} tugas buzzer terjadwal dibatalkan.`}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="rounded-xl border border-danger/40 bg-danger-soft/40 p-3.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
              <span className="w-5 h-5 rounded-full bg-danger text-on-accent text-[11px] flex items-center justify-center shrink-0">2</span>
              Dihapus permanen
            </h3>
            <ul className="mt-1.5 space-y-1 text-[13px] text-fg leading-relaxed list-disc pl-5">
              <li>
                {formatInt(preview.akun)} akun Threads milik workspace ini beserta Autopilot, antrean, dan statistiknya
              </li>
              <li>{formatInt(preview.anggota)} anggota kehilangan akses (akun penggunanya tidak dihapus)</li>
              <li>Pengaturan, paket{preview.paket ? ` (${preview.paket})` : ""}, ide konten, dan komentar</li>
              {preview.tagihanMenunggu > 0 && <li>{formatInt(preview.tagihanMenunggu)} tagihan yang belum dibayar dibatalkan</li>}
            </ul>
            <p className="mt-1.5 text-xs text-muted">Riwayat tagihan lunas dan log audit tetap disimpan.</p>
          </section>

          {!blocked && (
            <TextField
              label={`Ketik "${nama}" untuk konfirmasi`}
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                setFailure(null);
              }}
              maxLength={200}
              placeholder={nama}
              disabled={busy}
            />
          )}

          <FormError message={failure} />
        </form>
      )}
    </ModalShell>
  );
}
