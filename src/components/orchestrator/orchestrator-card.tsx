"use client";

import React, { useEffect, useState } from "react";
import { Play, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_BRIEF_CHARS } from "@/lib/content-validation";
import { CustomDropdown } from "./custom-dropdown";
import { CustomTimePicker } from "./custom-time-picker";
import { UnifiedReviewBoard } from "./unified-review-board";
import { isValidTime, useOrchestrator, type PublishMode } from "./orchestrator-store";

export interface OrchestratorPreset {
  /** null = semua akun. */
  accountIds: string[] | null;
  topic: string;
  time: string | null;
  /** Posting otomatis (sekarang/terjadwal); null = draf saja untuk ditinjau. */
  publish?: PublishMode | null;
}

/**
 * `sessionId` = id pesan chat; keadaan orkestrasi bertahan walau panel chat ditutup atau dibesarkan.
 * Dengan `preset` (cakupan yang sudah jelas dari chat) orkestrasi langsung berjalan, sekali per sesi.
 */
export function OrchestratorCard({ sessionId, preset }: { sessionId: string; preset?: OrchestratorPreset }) {
  const { state, api } = useOrchestrator(sessionId);
  const { config } = state;
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (preset) api.launch(preset);
  }, [api, preset]);

  // Konfirmasi "mulai ulang" kedaluwarsa sendiri supaya klik tak sengaja tidak membuang draf.
  useEffect(() => {
    if (!confirmReset) return;
    const timer = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmReset]);

  const canStart = config.mode === "auto" || isValidTime(config.time);

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden my-4 shadow-sm">
      <div className="px-4 py-3 border-b border-line bg-subtle flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" />
        <h3 className="font-semibold text-sm">Multi-Agent Orchestrator</h3>
        {state.step !== "CONFIG" && (
          <button
            type="button"
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              setConfirmReset(false);
              api.reset();
            }}
            className={cn(
              "ml-auto h-7 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer",
              confirmReset ? "bg-danger-soft text-danger" : "text-muted hover:text-fg hover:bg-surface"
            )}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {confirmReset ? "Klik lagi: draf dibuang" : "Mulai ulang"}
          </button>
        )}
      </div>
      <div className="p-4">
        {state.step === "CONFIG" ? (
          <div className="space-y-4">
            <p className="text-sm text-fg">
              Satu agen AI per akun: gaya tulisan diambil dari postingan akun itu sendiri, jam tayang dari jam
              ramainya.
            </p>
            <div className="space-y-3">
              <CustomDropdown value={config.account} onChange={(account) => api.setConfig({ account, accountIds: null })} />
              {config.account === "all" && config.accountIds && (
                <p className="-mt-1 text-xs text-muted">
                  Dibatasi ke {config.accountIds.length} akun pilihan dari chat. Pilih target lain untuk mengganti.
                </p>
              )}
              <CustomTimePicker
                mode={config.mode}
                time={config.time}
                onMode={(mode) => api.setConfig({ mode })}
                onTime={(time) => api.setConfig({ time })}
              />
              <div>
                <label
                  htmlFor={`${sessionId}-topic`}
                  className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5"
                >
                  Topik Konten (Opsional)
                </label>
                <input
                  id={`${sessionId}-topic`}
                  type="text"
                  maxLength={MAX_BRIEF_CHARS}
                  placeholder="Kosongkan agar tiap akun memilih topik dari niche-nya sendiri"
                  value={config.topic}
                  onChange={(e) => api.setConfig({ topic: e.target.value })}
                  className="w-full h-10 px-3 bg-surface border border-line rounded-lg text-sm text-fg placeholder:text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 hover:border-muted transition-colors"
                />
              </div>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={api.start}
                disabled={!canStart}
                className="w-full flex items-center justify-center gap-2 h-10 bg-accent text-on-accent rounded-lg font-medium text-sm hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" /> Mulai Orkestrasi
              </button>
            </div>
          </div>
        ) : (
          <UnifiedReviewBoard state={state} api={api} />
        )}
      </div>
    </div>
  );
}
