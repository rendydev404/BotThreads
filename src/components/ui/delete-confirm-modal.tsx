"use client";

import React from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useT } from "@/components/i18n/lang-provider";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  tableName: string;
  recordIdentifier: string;
  description?: string;
  isDeleting?: boolean;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  tableName,
  recordIdentifier,
  description,
  isDeleting = false,
}: DeleteConfirmModalProps) {
  const t = useT();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-[fade-in_200ms_ease-out]">
      <div className="bg-surface rounded-3xl p-6 md:p-8 max-w-lg w-full border border-line shadow-2xl relative transition-colors">
        <button
          onClick={onClose}
          disabled={isDeleting}
          aria-label={t("Tutup")}
          className="absolute top-6 right-6 text-muted hover:text-fg p-1 rounded-full hover:bg-subtle transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warning Icon Badge */}
        <div className="w-14 h-14 rounded-2xl bg-danger-soft text-danger flex items-center justify-center mb-5">
          <AlertTriangle className="w-7 h-7" strokeWidth={2.5} />
        </div>

        {/* H1 Mandatory Big Headline */}
        <h1 className="text-xl md:text-2xl font-black text-danger tracking-tight uppercase mb-3">
          {t("# KONFIRMASI PENGHAPUSAN DATA")}
        </h1>

        <p className="text-sm text-fg font-medium mb-4 leading-relaxed">
          {t("Tindakan ini bersifat destruktif dan akan menghapus data secara permanen dari database produksi. Pastikan Anda telah memeriksa kembali data yang akan dihapus.")}
        </p>

        {/* Record Details Card */}
        <div className="rounded-2xl bg-subtle p-4 border border-line mb-6 space-y-2 text-xs">
          <div className="flex justify-between items-center py-1 border-b border-line">
            <span className="text-muted font-semibold">{t("Tabel Target:")}</span>
            <span className="font-mono font-bold text-fg bg-surface px-2 py-0.5 rounded border border-line">
              {tableName}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-line">
            <span className="text-muted font-semibold">{t("Identitas Data:")}</span>
            <span className="font-mono font-bold text-accent">
              {recordIdentifier}
            </span>
          </div>
          {description && (
            <div className="pt-1">
              <span className="text-muted block mb-1">{t("Rincian Tambahan:")}</span>
              <p className="text-fg bg-surface p-2 rounded-lg border border-line">
                {description}
              </p>
            </div>
          )}
        </div>

        {/* Custom Actions (No Native Alert/Confirm) */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-muted bg-subtle hover:bg-subtle hover:text-fg transition-colors cursor-pointer"
          >
            {t("Batal")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-6 py-2.5 rounded-full text-sm font-semibold text-on-accent bg-danger hover:opacity-90 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? t("Menghapus...") : t("Ya, Hapus Data")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
