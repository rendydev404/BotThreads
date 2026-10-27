"use client";

import React from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { ModalButton, ModalShell } from "@/components/content/modal-shell";
import { useT } from "@/components/i18n/lang-provider";
import { tr } from "@/lib/i18n/core";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmIcon?: React.ReactNode;
  variant?: "primary" | "danger";
  busy?: boolean;
  error?: string | null;
  details?: string[];
  children?: React.ReactNode;
}

/** Konfirmasi kustom di atas ModalShell (pengganti window.confirm). */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmIcon,
  variant = "primary",
  busy = false,
  error,
  details,
  children,
}: ConfirmModalProps) {
  const t = useT();
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      busy={busy}
      title={t(title)}
      description={description && t(description)}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            {t("Batal")}
          </ModalButton>
          <ModalButton variant={variant} onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmIcon}
            {busy ? t("Memproses...") : t(confirmLabel)}
          </ModalButton>
        </>
      }
    >
      {children}
      {error && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p>{t(error)}</p>
            {details && details.length > 0 && (
              <ul className="mt-1 list-disc pl-4 font-normal">
                {details.slice(0, 8).map((d, i) => (
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

/** Kalimat konfirmasi mode Otomatis untuk satu akun. */
export const autoModeWarning = (handle: string, postsPerDay: number): string =>
  tr(
    "AI akan memposting ke {handle} tanpa persetujuan per posting, {n} kali sehari. Anda tetap bisa mengubah atau membatalkan posting di halaman Jadwal.",
    { handle, n: postsPerDay }
  );
