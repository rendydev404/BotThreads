"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { THREADS_MAX_TEXT } from "@/lib/threads-text";
import { formatWibFull, formatWibLabel, wibParts } from "@/lib/scheduling";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { PostTextField, checkPostText } from "@/components/content/post-text-field";
import { SchedulePicker } from "@/components/content/schedule-picker";
import type { AgentState, ReviewItem } from "./orchestrator-store";

interface Props {
  item: ReviewItem;
  agent?: AgentState;
  outletNama: string | null;
  /** Penjadwalan massal sedang berjalan: kartu dikunci. */
  locked: boolean;
  onChange: (patch: Partial<Pick<ReviewItem, "text" | "topic" | "at" | "included">>) => void;
  onRegenerate: () => void;
  /** Batalkan postingan yang sudah masuk antrean. */
  onCancel?: () => void;
}

const ACTION =
  "h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted";

const fmtMult = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;

/**
 * Satu draf per akun di papan review: teks bisa dibuka penuh, diedit, dibuat ulang, dilewati, dan
 * jam tayangnya (saran agen dari jam ramai akun itu) bisa diganti sebelum disetujui.
 */
export function ReviewDraftCard({ item, agent, outletNama, locked, onChange, onRegenerate, onCancel }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // Tombol "Lihat selengkapnya" hanya muncul bila teks memang terpotong pada lebar kartu saat ini.
  useEffect(() => {
    const el = textRef.current;
    if (!el || expanded || editing) return;
    const observer = new ResizeObserver(() => setOverflows(el.scrollHeight > el.clientHeight + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.text, expanded, editing]);

  const username = item.draft.username ?? agent?.username ?? agent?.displayName ?? "akun";
  const at = new Date(item.at);
  const parts = wibParts(at);
  const hourStat = item.draft.bestHours.find((b) => b.hour === parts.h);
  const check = checkPostText({ text: item.text, topic: item.topic }, outletNama);
  const edited = item.text.trim() !== item.draft.text.trim();
  const scheduled = item.status === "SCHEDULED";
  const working = item.status === "SCHEDULING" || item.status === "CANCELLING" || item.regenerating;
  const frozen = locked || scheduled || working;

  return (
    <article
      aria-busy={working}
      className={cn(
        "rounded-xl border bg-surface p-3.5 space-y-2.5 transition-colors",
        scheduled ? "border-success/50" : item.status === "FAILED" ? "border-danger/50" : "border-line hover:border-line-strong",
        !item.included && !scheduled && "opacity-60"
      )}
    >
      <header className="flex items-center gap-2">
        {!scheduled && (
          <button
            type="button"
            role="checkbox"
            aria-checked={item.included}
            aria-label={`Sertakan @${username} saat menjadwalkan`}
            disabled={frozen}
            onClick={() => onChange({ included: !item.included })}
            className={cn(
              "w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed",
              item.included ? "bg-accent border-accent text-on-accent" : "bg-surface border-line-strong text-transparent"
            )}
          >
            <Check className="w-3.5 h-3.5" strokeWidth={3} />
          </button>
        )}
        <AccountAvatar name={agent?.displayName ?? username} src={agent?.avatarUrl} size="w-6 h-6" />
        <span className="text-[13px] font-semibold text-fg truncate">@{username}</span>

        {scheduled ? (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-success-soft text-success text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {item.queuedMode === "now" ? "Diposting" : "Terjadwal"}
          </span>
        ) : working ? (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-muted">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {item.regenerating ? "Menulis ulang" : item.status === "CANCELLING" ? "Membatalkan" : "Menjadwalkan"}
          </span>
        ) : null}
      </header>

      <button
        type="button"
        disabled={frozen}
        onClick={() => setEditing(true)}
        title={`${formatWibFull(at)}. Klik untuk mengganti jam.`}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-xs font-semibold cursor-pointer disabled:cursor-default"
      >
        <Clock className="w-3.5 h-3.5" />
        {formatWibLabel(at)}
        {hourStat?.multiplier ? ` · ${fmtMult(hourStat.multiplier)} views` : ""}
      </button>

      {editing && !frozen ? (
        <div className="space-y-3">
          <PostTextField
            value={{ text: item.text, topic: item.topic }}
            onChange={(v) => onChange({ text: v.text, topic: v.topic })}
            outletNama={outletNama}
            rows={6}
          />
          <SchedulePicker
            value={{ mode: "at", at: item.at }}
            onChange={(v) => v.mode === "at" && v.at && onChange({ at: v.at })}
            bestHours={item.draft.bestHours}
            suggestedAt={item.draft.suggestedAt}
            allowNow={false}
          />
        </div>
      ) : (
        <div>
          <p
            ref={textRef}
            className={cn("text-sm text-fg whitespace-pre-wrap break-words leading-relaxed", !expanded && "line-clamp-4")}
          >
            {item.text}
          </p>
          {(overflows || expanded) && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline cursor-pointer"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Ringkas" : "Lihat selengkapnya"}
            </button>
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted leading-relaxed">
        <Sparkles className="w-3.5 h-3.5 mt-0.5 text-accent shrink-0" />
        <span className={cn(!expanded && !editing && "line-clamp-2")}>
          <span className="font-semibold text-fg">{item.draft.angle}.</span> {item.draft.rationale}
        </span>
      </p>

      {item.movedFrom && item.status === "SCHEDULED" && (
        <p className="flex items-start gap-1.5 rounded-lg bg-accent-soft text-accent px-2.5 py-2 text-xs font-medium">
          <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Digeser otomatis dari {formatWibLabel(new Date(item.movedFrom))} ke {formatWibLabel(at)} supaya tidak bentrok dengan postingan lain di akun ini.
        </p>
      )}

      {item.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-danger-soft text-danger px-2.5 py-2 text-xs font-medium">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {item.error}
        </p>
      )}

      {scheduled && onCancel && item.postId && (
        <footer className="flex items-center gap-1 -mx-1">
          <button type="button" onClick={onCancel} className={cn(ACTION, "hover:text-danger")}>
            <XCircle className="w-3.5 h-3.5" />
            Batalkan
          </button>
          <span className="ml-auto pr-1 text-[11px] text-faint">Edit lewat Jadwal Konten atau batalkan dulu</span>
        </footer>
      )}

      {!scheduled && (
        <footer className="flex items-center gap-1 -mx-1">
          <button
            type="button"
            disabled={frozen || (editing && !check.valid)}
            onClick={() => setEditing((v) => !v)}
            className={ACTION}
          >
            {editing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            {editing ? "Selesai" : "Edit"}
          </button>
          <button type="button" disabled={frozen} onClick={onRegenerate} className={ACTION}>
            <RefreshCw className={cn("w-3.5 h-3.5", item.regenerating && "animate-spin")} />
            Buat ulang
          </button>
          <span
            className={cn(
              "ml-auto pr-1 text-[11px] tabular-nums",
              check.length > THREADS_MAX_TEXT ? "text-danger font-semibold" : "text-faint"
            )}
          >
            {edited ? "Diedit · " : ""}
            {check.length}/{THREADS_MAX_TEXT}
          </span>
        </footer>
      )}
    </article>
  );
}
