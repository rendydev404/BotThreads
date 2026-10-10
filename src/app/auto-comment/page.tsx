"use client";

import React, { useState } from "react";
import {
  MessageCircle,
  Clock,
  Key,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Plus,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";

export default function AutoCommentPage() {
  const [isEnabled, setIsEnabled] = useState(true);
  const [keywords, setKeywords] = useState([
    { id: "kw-1", keyword: "shawarma juicy", active: true, count: 48 },
    { id: "kw-2", keyword: "kuliner arab surabaya", active: true, count: 32 },
    { id: "kw-3", keyword: "rekomendasi kebab enak", active: true, count: 21 },
    { id: "kw-4", keyword: "makanan timur tengah", active: true, count: 19 },
  ]);
  const [newKeyword, setNewKeyword] = useState("");

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedKeywordToDelete, setSelectedKeywordToDelete] = useState<{
    id: string;
    keyword: string;
  } | null>(null);

  const handleAddKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    setKeywords((prev) => [
      ...prev,
      {
        id: `kw-${Date.now()}`,
        keyword: newKeyword.trim().toLowerCase(),
        active: true,
        count: 0,
      },
    ]);
    setNewKeyword("");
  };

  const openDeleteModal = (kw: { id: string; keyword: string }) => {
    setSelectedKeywordToDelete(kw);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!selectedKeywordToDelete) return;
    setKeywords((prev) => prev.filter((k) => k.id !== selectedKeywordToDelete.id));
    setIsDeleteModalOpen(false);
    setSelectedKeywordToDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-[#343C6A] tracking-tight">
          Auto Comment Bot Management
        </h2>
        <p className="text-xs md:text-sm text-[#718EBF] mt-0.5">
          Kelola otomasi engagement Threads, kata kunci pencarian, dan slot jadwal interaksi
        </p>
      </div>

      {/* Overview Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Toggle Card */}
        <div className="neo-card p-6 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                isEnabled
                  ? "bg-[#16DBCC]/15 text-[#16DBCC]"
                  : "bg-[#718EBF]/15 text-[#718EBF]"
              )}
            >
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">Status Otomasi</p>
              <p className="text-xs text-[#718EBF]">
                {isEnabled ? "Bot Aktif Berjalan" : "Bot Dijeda"}
              </p>
            </div>
          </div>
          {/* Custom Toggle Switch (No Native OS Checkbox) */}
          <button
            onClick={() => setIsEnabled(!isEnabled)}
            className={cn(
              "w-14 h-8 rounded-full p-1 transition-colors cursor-pointer relative",
              isEnabled ? "bg-[#1814F3]" : "bg-[#EDF2F7]"
            )}
          >
            <div
              className={cn(
                "w-6 h-6 rounded-full bg-white shadow-sm transition-transform",
                isEnabled ? "translate-x-6" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {/* Slot Scheduling Card */}
        <div className="neo-card p-6 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">Slot Jadwal Hari Ini</p>
              <p className="text-xs text-[#718EBF]">11:30, 14:00, 18:30 WIB</p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-[#1814F3] bg-[#1814F3]/10 px-2.5 py-1 rounded-full">
            3 Slot
          </span>
        </div>

        {/* Guardrail Cooldown */}
        <div className="neo-card p-6 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#FFBB38]/15 text-[#FFBB38] flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#343C6A]">Anti-Keroyokan</p>
              <p className="text-xs text-[#718EBF]">Cooldown 30 hari per target author</p>
            </div>
          </div>
          <span className="text-xs font-bold text-[#16DBCC]">Aman</span>
        </div>
      </div>

      {/* Keywords Management Card */}
      <div className="neo-card p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#EDF2F7]">
          <div>
            <h3 className="text-base font-bold text-[#343C6A]">
              Daftar Kata Kunci Pencarian Threads
            </h3>
            <p className="text-xs text-[#718EBF]">
              Bot akan mencari postingan organik publik yang memuat keyword ini
            </p>
          </div>

          {/* Custom Add Keyword Form */}
          <form onSubmit={handleAddKeyword} className="flex items-center gap-2">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              placeholder="Tambah keyword baru..."
              className="w-48 sm:w-64 h-10 px-4 bg-[#F5F7FA] text-xs text-[#343C6A] rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!newKeyword.trim()}
              className="h-10 px-4 rounded-full bg-[#1814F3] hover:bg-[#120ec0] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah</span>
            </button>
          </form>
        </div>

        {/* Keywords Chips */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          {keywords.map((kw) => (
            <div
              key={kw.id}
              className="p-4 rounded-2xl bg-[#F4F7FE] border border-[#EDF2F7] flex items-center justify-between group hover:border-[#1814F3]/30 transition-all"
            >
              <div className="flex items-center gap-2.5">
                <Key className="w-4 h-4 text-[#1814F3]" />
                <div>
                  <p className="text-xs font-bold text-[#343C6A]">{kw.keyword}</p>
                  <p className="text-[10px] text-[#718EBF]">{kw.count} target ditemukan</p>
                </div>
              </div>
              <button
                onClick={() => openDeleteModal(kw)}
                aria-label="Hapus kata kunci"
                className="w-7 h-7 rounded-full text-[#718EBF] hover:text-[#FF4B4A] hover:bg-[#FF4B4A]/10 flex items-center justify-center transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Mandatory Destructive Action Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        tableName="AutoCommentKeyword"
        recordIdentifier={`Keyword: "${selectedKeywordToDelete?.keyword}"`}
        description="Menghapus keyword ini akan menghentikan bot mencari postingan dengan kata kunci tersebut di Threads."
      />
    </div>
  );
}
