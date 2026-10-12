"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, CheckCircle2, ChevronDown, Info, Loader2, RefreshCw, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWibFull } from "@/lib/scheduling";
import { checkPostText } from "@/components/content/post-text-field";
import { PublishConfirmModal } from "@/components/content/publish-confirm-modal";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";
import { AgentNodeGrid } from "./agent-node-grid";
import { PublishPipeline } from "./publish-pipeline";
import { ReviewDraftCard } from "./review-draft-card";
import type { OrchestratorApi, OrchestratorState } from "./orchestrator-store";

interface Props {
  state: OrchestratorState;
  api: OrchestratorApi;
}

/** Detik berjalan selama orkestrasi; setelah selesai memakai durasi dari server. */
function useElapsedSeconds(startedAt: number | null, running: boolean, finalMs: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);
  return !running && finalMs !== null ? Math.round(finalMs / 1000) : seconds;
}

/**
 * Papan kerja orkestrator: progres agen, lalu draf tiap akun untuk direview. Draf muncul begitu
 * agennya selesai (tidak menunggu semua akun), dan baru masuk antrean setelah disetujui.
 */
export function UnifiedReviewBoard({ state, api }: Props) {
  const { accounts, publishEnabled, limits, loading } = usePublishAccounts();
  const [confirming, setConfirming] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showPosts, setShowPosts] = useState(false);
  const seconds = useElapsedSeconds(state.startedAt, state.running, state.elapsedMs);

  const agentById = useMemo(() => new Map(state.agents.map((a) => [a.id, a])), [state.agents]);
  const outletById = useMemo(() => new Map(accounts.map((a) => [a.id, a.outletNama])), [accounts]);

  const active = state.agents.filter((a) => a.status !== "SKIPPED");
  const finished = active.filter((a) => a.status === "SUCCESS" || a.status === "ERROR").length;
  const failedAgents = state.agents.filter((a) => a.status === "ERROR");
  const skippedAgents = state.agents.filter((a) => a.status === "SKIPPED");

  const scheduled = state.items.filter((i) => i.status === "SCHEDULED");
  const rejected = state.items.filter((i) => i.status === "FAILED");
  const targets = state.items.filter(
    (i) => i.included && !i.regenerating && (i.status === "DRAFT" || i.status === "FAILED")
  );
  const invalid = targets.filter(
    (i) => !checkPostText({ text: i.text, topic: i.topic }, outletById.get(i.accountId) ?? null).valid
  );
  const canSchedule =
    publishEnabled && !loading && !state.running && !state.scheduling && targets.length > 0 && invalid.length === 0;

  const publish = state.config.publish;
  const queued = state.items.filter((i) => i.status === "SCHEDULED").length;
  const queueFailed = state.items.filter((i) => i.status === "FAILED").length;

  return (
    // Lebar kartu mengikuti panel chat (mengambang sempit atau layar penuh), bukan lebar jendela.
    <div className="@container space-y-4">
      {publish && <PublishPipeline state={state} />}
      <div className={cn("space-y-2", publish && "hidden")}>
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg min-w-0">
            {state.running ? (
              <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
            ) : state.items.length > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-muted shrink-0" />
            )}
            <span className="truncate">
              {state.running
                ? `${publish ? "Agen menulis & mengantrekan" : "Agen menulis draf"} · ${finished}/${active.length || "..."}`
                : publish && state.items.length > 0
                  ? `${queued} ${publish.mode === "now" ? "diposting" : "terjadwal"}${queueFailed ? ` · ${queueFailed} gagal` : ""}`
                  : state.items.length > 0
                    ? `${state.items.length} draf siap direview`
                    : "Belum ada draf"}
            </span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted tabular-nums">{seconds} dtk</span>
            {state.running ? (
              <button
                type="button"
                onClick={api.cancel}
                className="h-7 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 border border-line-strong text-fg hover:border-danger hover:text-danger transition-colors cursor-pointer"
              >
                <Square className="w-3 h-3" />
                Hentikan
              </button>
            ) : (
              state.agents.length > 0 && (
                <button
                  type="button"
                  aria-expanded={showAgents}
                  onClick={() => setShowAgents((v) => !v)}
                  className="h-7 px-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1 text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
                >
                  Status agen
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showAgents && "rotate-180")} />
                </button>
              )
            )}
          </div>
        </div>
        {state.running && (
          <div className="h-1.5 rounded-full bg-subtle overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={active.length} aria-valuenow={finished}>
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${active.length ? (finished / active.length) * 100 : 0}%` }}
            />
          </div>
        )}
        {(state.running || showAgents) && <AgentNodeGrid agents={state.agents} />}
      </div>

      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft text-danger p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {state.error}
        </p>
      )}

      {!state.running && failedAgents.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warning-soft text-warning p-3 text-[13px] font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-48">
            {failedAgents.length} akun belum dapat draf:{" "}
            {failedAgents
              .slice(0, 6)
              .map((a) => `@${a.username ?? a.displayName}`)
              .join(", ")}
            {failedAgents.length > 6 ? ` dan ${failedAgents.length - 6} lainnya` : ""}. {failedAgents[0].error}
          </span>
          <button
            type="button"
            onClick={api.retryFailed}
            className="h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 bg-surface text-fg border border-line-strong hover:border-accent hover:text-accent transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Coba lagi ({failedAgents.length})
          </button>
        </div>
      )}

      {skippedAgents.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-subtle text-muted p-3 text-[13px]">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {skippedAgents.length} akun dilewati karena belum siap diposting:{" "}
            {skippedAgents
              .slice(0, 6)
              .map((a) => `@${a.username ?? a.displayName} (${a.error})`)
              .join(", ")}
            {skippedAgents.length > 6 ? ` dan ${skippedAgents.length - 6} lainnya` : ""}.
          </span>
        </p>
      )}

      {publish && state.items.length > 0 && (
        <button
          type="button"
          aria-expanded={showPosts}
          onClick={() => setShowPosts((v) => !v)}
          className="h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer"
        >
          {showPosts ? "Sembunyikan" : "Lihat"} teks postingan ({state.items.length}), edit atau batalkan
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showPosts && "rotate-180")} />
        </button>
      )}

      {publish && !showPosts ? null : state.items.length > 0 ? (
        <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-3 items-start max-h-[65vh] overflow-y-auto pr-1">
          {state.items.map((item) => (
            <ReviewDraftCard
              key={item.accountId}
              item={item}
              agent={agentById.get(item.accountId)}
              outletNama={outletById.get(item.accountId) ?? null}
              locked={state.scheduling}
              onChange={(patch) => api.updateItem(item.accountId, patch)}
              onRegenerate={() => api.regenerate(item.accountId)}
              onCancel={() => api.cancelItem(item.accountId)}
            />
          ))}
        </div>
      ) : (
        !state.running && (
          <p className="text-sm text-muted">Belum ada draf. Coba lagi, atau mulai ulang dengan pengaturan lain.</p>
        )
      )}

      {scheduled.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-success-soft text-success p-3 text-[13px] font-medium" aria-live="polite">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            {scheduled.length} postingan masuk antrean dan tayang di jam masing-masing akun.
            {rejected.length > 0 ? ` ${rejected.length} lainnya ditolak, alasannya tertera di kartunya.` : ""}
          </span>
          <Link href="/jadwal" className="font-semibold underline underline-offset-2">
            Buka Jadwal Konten
          </Link>
        </p>
      )}

      {state.items.length > 0 && !(publish && targets.length === 0) && (
        <div className="space-y-2">
          {!loading && !publishEnabled && (
            <p className="flex items-start gap-2 rounded-xl bg-subtle text-muted p-3 text-[13px] font-medium">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              Fitur posting belum diaktifkan oleh pemilik dashboard. Draf tetap bisa direview dan diedit.
            </p>
          )}
          {invalid.length > 0 && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {invalid.length} draf terpilih masih melanggar aturan teks (terlalu panjang, kosong, atau topik tidak valid).
            </p>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canSchedule}
            className="w-full flex items-center justify-center gap-2 h-10 bg-accent text-on-accent rounded-lg font-medium text-sm hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {state.scheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : targets.length ? <Send className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
            {state.scheduling
              ? "Menjadwalkan..."
              : state.running
                ? "Menunggu semua agen selesai..."
                : targets.length
                  ? `Setujui & Jadwalkan (${targets.length})`
                  : "Tidak ada draf terpilih"}
          </button>
        </div>
      )}

      <PublishConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void api.schedule(limits?.maxBatchItems);
        }}
        mode="schedule"
        busy={false}
        error={null}
        targets={targets.map((i) => ({
          username: i.draft.username ?? agentById.get(i.accountId)?.displayName ?? "akun",
          text: i.text.trim(),
          whenLabel: formatWibFull(new Date(i.at)),
        }))}
      />
    </div>
  );
}
