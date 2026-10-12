"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, Clock, Copy, Lightbulb, TerminalSquare, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentDraft } from "@/lib/content-types";
import { ideaPostText, ideaSegments, nextWibSlot, type PostIdea } from "@/lib/idea-block";
import { formatWibFull } from "@/lib/scheduling";
import { THREADS_MAX_TEXT } from "@/lib/threads-text";
import { DraftCard } from "@/components/content/draft-card";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { usePublishAccounts } from "@/components/content/use-publish-accounts";

const pad = (n: number) => String(n).padStart(2, "0");

const BTN =
  "h-9 px-3.5 rounded-full text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1800);
    } catch {
      /* clipboard tidak tersedia */
    }
  };
  return { copied, copy };
}

/** Indikator panjang teks terhadap batas Threads. */
function CharMeter({ chars }: { chars: number }) {
  const ratio = Math.min(1, chars / THREADS_MAX_TEXT);
  const tone = chars > THREADS_MAX_TEXT ? "bg-danger" : chars > THREADS_MAX_TEXT * 0.9 ? "bg-warning" : "bg-success";
  return (
    <div className="flex items-center gap-2 text-xs text-muted" title="Batas Threads 500 karakter">
      <div className="w-16 h-1.5 rounded-full bg-subtle overflow-hidden">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className={cn("tabular-nums", chars > THREADS_MAX_TEXT && "text-danger font-semibold")}>
        {chars}/{THREADS_MAX_TEXT}
      </span>
    </div>
  );
}

/**
 * Kartu ide postingan dari jawaban asisten: pratinjau ala Threads, prompt AI disorot dan bisa
 * disalin terpisah, alasan berbasis data, lalu "Siapkan posting" mengubahnya jadi kartu draf
 * (edit, jadwalkan, posting) tanpa menulis ulang teksnya.
 */
export function IdeaCard({ idea, index }: { idea: PostIdea; index: number }) {
  const { accounts } = usePublishAccounts();
  const { copied, copy } = useCopy();
  const [draft, setDraft] = useState<ContentDraft | null>(null);

  const account = useMemo(
    () => (idea.account ? accounts.find((a) => a.username?.toLowerCase() === idea.account?.toLowerCase()) ?? null : null),
    [accounts, idea.account]
  );
  const segments = useMemo(() => ideaSegments(idea.body), [idea.body]);
  const postText = useMemo(() => ideaPostText(idea.body), [idea.body]);
  const chars = [...postText].length;
  const handle = idea.account ? `@${idea.account}` : "Semua akun";

  if (draft) return <DraftCard draft={draft} index={index} />;

  const prepare = () => {
    const at = nextWibSlot(idea.time);
    setDraft({
      id: `idea-${index}-${at.getTime()}`,
      threadsAccountId: account?.id ?? "",
      username: account?.username ?? idea.account,
      text: postText,
      topicTag: null,
      suggestedAt: at.toISOString(),
      suggestedLabel: formatWibFull(at),
      angle: idea.angle || "Ide dari chat",
      rationale: idea.reason,
      chars,
      bestHours: [],
      model: "chat",
    });
  };

  return (
    <article className="relative rounded-2xl border border-line bg-surface overflow-hidden shadow-sm transition-shadow hover:shadow-pop">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-accent/50 to-success/60" aria-hidden />

      <header className="flex items-center gap-3 px-4 pt-4">
        <AccountAvatar
          name={account?.displayName ?? idea.account ?? "AI"}
          src={account?.avatarUrl}
          size="w-10 h-10"
          className="ring-2 ring-accent-soft"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-semibold text-fg truncate">{handle}</p>
          <p className="text-xs text-muted truncate">{account?.outletNama ?? account?.displayName ?? "Ide postingan"}</p>
        </div>
        {idea.time && (
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-accent-soft text-accent text-xs font-semibold shrink-0">
            <Clock className="w-3.5 h-3.5" />
            {pad(idea.time.h)}:{pad(idea.time.m)} WIB
          </span>
        )}
      </header>

      <div className="px-4 mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-on-accent">
          Ide {index}
        </span>
        {idea.angle && (
          <span className="inline-flex items-center gap-1 rounded-md bg-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <Lightbulb className="w-3 h-3 text-warning" />
            {idea.angle}
          </span>
        )}
      </div>

      <div className="px-4 mt-3 space-y-3 text-[14.5px] leading-relaxed text-fg break-words">
        {segments.map((s, i) =>
          s.kind === "prompt" ? (
            <div key={i} className="rounded-xl border border-accent/30 bg-subtle overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-line bg-accent-soft/60">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <TerminalSquare className="w-3.5 h-3.5" />
                  Prompt siap pakai
                </span>
                <button
                  type="button"
                  onClick={() => copy(`p${i}`, s.text)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg cursor-pointer"
                >
                  {copied === `p${i}` ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === `p${i}` ? "Tersalin" : "Salin prompt"}
                </button>
              </div>
              <pre className="px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-words text-fg">
                {s.text}
              </pre>
            </div>
          ) : (
            <p key={i} className="whitespace-pre-line">
              {s.text}
            </p>
          )
        )}
      </div>

      {idea.reason && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl bg-success-soft/70 px-3 py-2 text-[13px] leading-relaxed text-fg">
          <TrendingUp className="w-4 h-4 mt-0.5 text-success shrink-0" />
          <p>
            <span className="font-semibold">Kenapa: </span>
            {idea.reason}
          </p>
        </div>
      )}

      <footer className="mt-4 px-4 py-3 border-t border-line flex flex-wrap items-center gap-x-3 gap-y-2">
        <CharMeter chars={chars} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copy("text", postText)}
            className={cn(BTN, "border border-line-strong bg-surface text-fg hover:border-accent hover:text-accent")}
          >
            {copied === "text" ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            {copied === "text" ? "Tersalin" : "Salin teks"}
          </button>
          <button type="button" onClick={prepare} className={cn(BTN, "bg-accent text-on-accent hover:bg-accent-hover")}>
            <CalendarClock className="w-4 h-4" />
            Siapkan posting
          </button>
        </div>
      </footer>
    </article>
  );
}
