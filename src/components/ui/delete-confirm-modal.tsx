"use client";

import React from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#111827] rounded-3xl p-6 md:p-8 max-w-lg w-full border border-[#EDF2F7] dark:border-[#1F2937] shadow-2xl relative transition-colors">
        <button
          onClick={onClose}
          disabled={isDeleting}
          className="absolute top-6 right-6 text-[#718EBF] dark:text-[#94A3B8] hover:text-[#343C6A] dark:hover:text-[#F8FAFC] p-1 rounded-full hover:bg-[#F4F7FE] dark:hover:bg-[#1E293B] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warning Icon Badge */}
        <div className="w-14 h-14 rounded-2xl bg-[#FF4B4A]/10 text-[#FF4B4A] flex items-center justify-center mb-5">
          <AlertTriangle className="w-7 h-7" strokeWidth={2.5} />
        </div>

        {/* H1 Mandatory Big Headline */}
        <h1 className="text-xl md:text-2xl font-black text-[#FF4B4A] tracking-tight uppercase mb-3">
          # KONFIRMASI PENGHAPUSAN DATA
        </h1>

        <p className="text-sm text-[#343C6A] dark:text-[#CBD5E1] font-medium mb-4 leading-relaxed">
          Tindakan ini bersifat destruktif dan akan menghapus data secara permanen dari database produksi. Pastikan Anda telah memeriksa kembali data yang akan dihapus.
        </p>

        {/* Record Details Card */}
        <div className="rounded-2xl bg-[#F4F7FE] dark:bg-[#1E293B]/60 p-4 border border-[#EDF2F7] dark:border-[#1F2937] mb-6 space-y-2 text-xs">
          <div className="flex justify-between items-center py-1 border-b border-[#EDF2F7] dark:border-[#1F2937]">
            <span className="text-[#718EBF] dark:text-[#94A3B8] font-semibold">Tabel Target:</span>
            <span className="font-mono font-bold text-[#343C6A] dark:text-[#F8FAFC] bg-white dark:bg-[#111827] px-2 py-0.5 rounded border border-[#EDF2F7] dark:border-[#334155]">
              {tableName}
            </span>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[#EDF2F7] dark:border-[#1F2937]">
            <span className="text-[#718EBF] dark:text-[#94A3B8] font-semibold">Identitas Data:</span>
            <span className="font-mono font-bold text-[#1814F3] dark:text-blue-400">
              {recordIdentifier}
            </span>
          </div>
          {description && (
            <div className="pt-1">
              <span className="text-[#718EBF] dark:text-[#94A3B8] block mb-1">Rincian Tambahan:</span>
              <p className="text-[#343C6A] dark:text-[#CBD5E1] bg-white dark:bg-[#111827] p-2 rounded-lg border border-[#EDF2F7] dark:border-[#334155]">
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
            className="px-5 py-2.5 rounded-full text-sm font-semibold text-[#718EBF] dark:text-[#94A3B8] bg-[#F4F7FE] dark:bg-[#1E293B] hover:bg-[#EAEFF8] dark:hover:bg-[#334155] hover:text-[#343C6A] dark:hover:text-white transition-colors cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-6 py-2.5 rounded-full text-sm font-semibold text-white bg-[#FF4B4A] hover:bg-[#E03E3E] transition-colors shadow-lg shadow-[#FF4B4A]/25 flex items-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>{isDeleting ? "Menghapus..." : "Ya, Hapus Data"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
