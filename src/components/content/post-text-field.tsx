"use client";

import React, { useId } from "react";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { THREADS_MAX_TEXT, charLength, hasBranchTag, parseTopicTag, validateThreadsText } from "@/lib/threads-text";

export interface PostTextState {
  text: string;
  topic: string;
}

/** Hasil validasi klien (server tetap memvalidasi ulang). */
export function checkPostText(state: PostTextState, outletNama: string | null) {
  const topic = parseTopicTag(state.topic);
  const text = state.text.trim()
    ? validateThreadsText(state.text, outletNama ?? "", topic.ok ? topic.tag : null)
    : null;
  const length = text ? text.length : 0;
  const error = !state.text.trim()
    ? "Teks postingan tidak boleh kosong."
    : !topic.ok
      ? topic.error
      : text && !text.ok
        ? text.error
        : null;
  return { length, error, topicTag: topic.ok ? topic.tag : null, valid: !error };
}

interface PostTextFieldProps {
  value: PostTextState;
  onChange: (v: PostTextState) => void;
  outletNama?: string | null;
  disabled?: boolean;
  rows?: number;
  /** Tampilkan peringatan {nama_cabang} untuk posting multi-akun. */
  placeholder?: string;
}

/** Textarea + penghitung karakter x/500 (kuning > 450, merah > 500) + kolom topik. */
export function PostTextField({ value, onChange, outletNama = null, disabled, rows = 5, placeholder }: PostTextFieldProps) {
  const id = useId();
  const check = checkPostText(value, outletNama);
  const len = value.text.trim() ? check.length || charLength(value.text) : 0;
  const over = len > THREADS_MAX_TEXT;
  const warn = len > 450 && !over;
  const topic = parseTopicTag(value.topic);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-xl border bg-surface transition-colors focus-within:ring-4 focus-within:ring-accent/15",
          over ? "border-danger" : "border-line-strong focus-within:border-accent"
        )}
      >
        <textarea
          id={id}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder ?? "Tulis isi postingan..."}
          aria-label="Isi postingan"
          aria-invalid={over}
          className="w-full resize-y bg-transparent border-0 px-3.5 pt-3 pb-1 text-sm leading-relaxed text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0 disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-3.5 pb-2 text-xs">
          <span className="text-faint">{hasBranchTag(value.text) ? "Nama cabang akan terisi otomatis." : ""}</span>
          <span
            aria-live="polite"
            className={cn("font-semibold tabular-nums", over ? "text-danger" : warn ? "text-warning" : "text-muted")}
          >
            {len}/{THREADS_MAX_TEXT}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex items-center gap-1.5 h-9 pl-2.5 pr-3 rounded-full border bg-surface flex-1 min-w-0 sm:flex-none sm:w-64 transition-colors focus-within:border-accent",
            topic.ok ? "border-line-strong" : "border-danger"
          )}
        >
          <Hash className="w-3.5 h-3.5 text-muted shrink-0" />
          <input
            type="text"
            value={value.topic}
            onChange={(e) => onChange({ ...value, topic: e.target.value.replace(/^#+/, "") })}
            disabled={disabled}
            maxLength={60}
            placeholder="Topik (opsional)"
            aria-label="Topik"
            aria-invalid={!topic.ok}
            className="flex-1 min-w-0 bg-transparent border-0 text-[13px] text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
          />
        </div>
      </div>
      {!topic.ok && (
        <p role="alert" className="text-xs font-medium text-danger">
          {topic.error}
        </p>
      )}
      {over && (
        <p role="alert" className="text-xs font-medium text-danger">
          Teks melebihi {THREADS_MAX_TEXT} karakter. Persingkat dulu sebelum diposting.
        </p>
      )}
    </div>
  );
}
