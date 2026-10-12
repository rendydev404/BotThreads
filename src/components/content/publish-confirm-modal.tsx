"use client";

import React from "react";
import { AlertCircle, CalendarClock, Loader2, Send } from "lucide-react";
import { clipChars } from "@/lib/threads-text";
import { ModalButton, ModalShell } from "./modal-shell";

export interface ConfirmTarget {
  username: string;
  text: string;
  /** Label waktu tayang (WIB); kosong untuk posting sekarang. */
  whenLabel?: string;
}

interface PublishConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  mode: "now" | "schedule";
  targets: ConfirmTarget[];
  busy: boolean;
  error: string | null;
  details?: string[];
}

/** Konfirmasi sebelum memasukkan postingan ke antrean (selalu ada klik manusia). */
export function PublishConfirmModal({
  open,
  onClose,
  onConfirm,
  mode,
  targets,
  busy,
  error,
  details,
}: PublishConfirmModalProps) {
  const now = mode === "now";
  const many = targets.length > 1;
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      busy={busy}
      title={now ? (many ? `Posting sekarang ke ${targets.length} akun?` : "Posting sekarang?") : many ? `Jadwalkan ${targets.length} postingan?` : "Jadwalkan postingan?"}
      description={
        now
          ? "Postingan masuk antrean penerbit dan tayang dalam kurang lebih 30 detik. Setelah diproses tidak bisa dibatalkan."
          : "Postingan akan tayang otomatis pada jam yang dipilih. Sebelum waktunya Anda masih bisa mengubah atau membatalkannya."
      }
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Batal
          </ModalButton>
          <ModalButton variant="primary" onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : now ? <Send className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
            {busy ? "Memproses..." : now ? "Ya, posting sekarang" : "Ya, jadwalkan"}
          </ModalButton>
        </>
      }
    >
      <ul className="space-y-2">
        {targets.map((t, i) => (
          <li key={i} className="rounded-xl border border-line bg-subtle p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold">
              <span className="text-accent truncate">@{t.username}</span>
              {t.whenLabel && <span className="text-muted shrink-0">{t.whenLabel}</span>}
            </div>
            <p className="mt-1 text-[13px] text-fg whitespace-pre-wrap break-words">{clipChars(t.text, 220)}</p>
          </li>
        ))}
      </ul>
      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{error}</p>
            {details && details.length > 1 && (
              <ul className="mt-1 list-disc pl-4 font-normal">
                {details.slice(1, 6).map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
