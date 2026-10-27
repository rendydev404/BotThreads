"use client";

import React, { useId } from "react";
import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { THREADS_MAX_TEXT, charLength, hasBranchTag, parseTopicTag, validateThreadsText } from "@/lib/threads-text";
import type { TFunction } from "@/lib/i18n/core";
import { useT } from "@/components/i18n/lang-provider";

/**
 * Terjemahkan pesan galat konten (validasi klien atau API) yang tampil apa adanya. Pesan ber-awalan
 * "@akun: " dan pesan dengan angka/alasan dinamis dipecah dulu supaya kuncinya tetap cocok dengan kamus.
 */
export function tContentMessage(t: TFunction, msg: string | null | undefined): string {
  if (!msg) return "";
  const prefixed = /^(@[^\s:]+): ([\s\S]+)$/.exec(msg);
  if (prefixed) return `${prefixed[1]}: ${tContentMessage(t, prefixed[2])}`;
  let m = /^Teks (\d+) karakter\. Threads maksimal (\d+) karakter\.$/.exec(msg);
  if (m) return t("Teks {n} karakter. Threads maksimal {max} karakter.", { n: m[1], max: m[2] });
  m = /^Teks dan kredit foto (\d+) karakter\. Threads maksimal (\d+) karakter\.$/.exec(msg);
  if (m) return t("Teks dan kredit foto {n} karakter. Threads maksimal {max} karakter.", { n: m[1], max: m[2] });
  m = /^Akun belum siap diposting: (.*)\.$/.exec(msg);
  if (m) return t("Akun belum siap diposting: {reason}.", { reason: t(m[1]) });
  m = /^akun belum siap diposting \((.*)\)\.$/.exec(msg);
  if (m) return t("akun belum siap diposting ({reason}).", { reason: t(m[1]) });
  m = /^Batas (\d+) postingan dashboard per akun per hari sudah tercapai untuk tanggal tersebut\.$/.exec(msg);
  if (m) return t("Batas {n} postingan dashboard per akun per hari sudah tercapai untuk tanggal tersebut.", { n: m[1] });
  m = /^Jarak dengan postingan lain di akun ini kurang dari (\d+) menit \(sudah ada yang tayang (.+)\)\.$/.exec(msg);
  if (m) return t("Jarak dengan postingan lain di akun ini kurang dari {n} menit (sudah ada yang tayang {when}).", { n: m[1], when: m[2] });
  m = /^Maksimal (\d+) postingan dalam satu kali kirim\.$/.exec(msg);
  if (m) return t("Maksimal {n} postingan dalam satu kali kirim.", { n: m[1] });
  m = /^Item (\d+): ([\s\S]+)$/.exec(msg);
  if (m) return t("Item {n}: {error}", { n: m[1], error: tContentMessage(t, m[2]) });
  return t(msg);
}

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
  const t = useT();
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
          placeholder={placeholder ?? t("Tulis isi postingan...")}
          aria-label={t("Isi postingan")}
          aria-invalid={over}
          className="w-full resize-y bg-transparent border-0 px-3.5 pt-3 pb-1 text-sm leading-relaxed text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0 disabled:opacity-60"
        />
        <div className="flex items-center justify-between px-3.5 pb-2 text-xs">
          <span className="text-faint">{hasBranchTag(value.text) ? t("Nama cabang akan terisi otomatis.") : ""}</span>
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
            placeholder={t("Topik (opsional)")}
            aria-label={t("Topik")}
            aria-invalid={!topic.ok}
            className="flex-1 min-w-0 bg-transparent border-0 text-[13px] text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
          />
        </div>
      </div>
      {!topic.ok && (
        <p role="alert" className="text-xs font-medium text-danger">
          {tContentMessage(t, topic.error)}
        </p>
      )}
      {over && (
        <p role="alert" className="text-xs font-medium text-danger">
          {t("Teks melebihi {max} karakter. Persingkat dulu sebelum diposting.", { max: THREADS_MAX_TEXT })}
        </p>
      )}
    </div>
  );
}
