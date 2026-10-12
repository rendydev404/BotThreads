"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  MessageSquarePlus,
  RotateCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown, type CodeRenderer } from "./markdown";
import { IdeaCard } from "./idea-card";
import { ScopeDialog } from "./scope-dialog";
import { IDEA_LANG, ideaPlainText, parseIdea } from "@/lib/idea-block";
import { OrchestratorCard } from "@/components/orchestrator/orchestrator-card";
import { quickActions, type ChatApi, type ChatMessage } from "./use-chat";
import { ReportCard } from "./report-card";
import { DraftCard } from "@/components/content/draft-card";

/** Blok ```ide pada jawaban asisten dirender sebagai kartu ide bernomor urut. */
function ideaRenderer(): CodeRenderer {
  return function renderIdea(lang, code, _key, ordinal) {
    if (lang !== IDEA_LANG) return null;
    const idea = parseIdea(code);
    return idea ? <IdeaCard idea={idea} index={ordinal} /> : null;
  };
}

interface ChatPanelProps {
  chat: ChatApi;
  /** Mode ringkas untuk jendela bubble */
  compact?: boolean;
  /** Teks awal yang dipakai kolom input */
  className?: string;
}

export function ChatPanel({ chat, compact = false, className }: ChatPanelProps) {
  const { messages, isLoading, send, retry, reset } = chat;
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length === 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isLoading]);

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const submit = (text = draft) => {
    if (!text.trim() || isLoading) return;
    send(text);
    setDraft("");
    requestAnimationFrame(() => {
      resizeInput();
      inputRef.current?.focus();
    });
  };

  const copy = async (m: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(ideaPlainText(m.content));
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* clipboard tidak tersedia */
    }
  };

  return (
    <div className={cn("flex flex-col min-h-0 h-full", className)}>
      {/* Aksi percakapan */}
      {!isEmpty && (
        <div className="px-4 py-2 border-b border-line flex justify-end">
          <button
            type="button"
            onClick={reset}
            disabled={isLoading}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer disabled:opacity-40"
          >
            <MessageSquarePlus className="w-4 h-4" />
            Percakapan baru
          </button>
        </div>
      )}

      {/* Percakapan */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div
          className={cn(
            "mx-auto w-full px-4 py-5 space-y-5",
            compact ? "" : "max-w-3xl"
          )}
        >
          {isEmpty ? (
            <div className={cn("text-center", compact ? "pt-2" : "pt-8")}>
              <div className="mx-auto w-11 h-11 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-fg">
                Tanya apa saja soal akun Threads
              </h3>
              <p className="mt-1 text-sm text-muted">
                Jawaban diambil dari data semua akun dan postingannya.
              </p>

              <div className="mt-6 grid gap-2 text-left">
                {quickActions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => submit(a.prompt)}
                    className="px-4 py-3 rounded-xl border border-line bg-surface hover:border-accent hover:bg-accent-soft/50 text-sm text-fg transition-colors cursor-pointer"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const isUser = m.role === "user";
              const isLast = i === messages.length - 1;

              if (isUser) {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-accent text-on-accent text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className="flex gap-3">
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      m.isError
                        ? "bg-danger-soft text-danger"
                        : "bg-accent-soft text-accent"
                    )}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {m.report && (
                      <div className="mb-3">
                        <ReportCard
                          report={m.report}
                          onPickAccount={(u) =>
                            submit(`Analisis akun @${u} dalam ${m.report?.days ?? 7} hari terakhir`)
                          }
                        />
                      </div>
                    )}
                    <div
                      className={cn(
                        "text-sm leading-relaxed break-words",
                        m.isError ? "text-danger" : "text-fg"
                      )}
                    >
                      {m.pending ? (
                        <span className="inline-flex items-center gap-2 text-muted">
                          <span className="flex gap-1" aria-hidden>
                            {[0, 1, 2].map((d) => (
                              <span
                                key={d}
                                className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce"
                                style={{ animationDelay: `${d * 150}ms` }}
                              />
                            ))}
                          </span>
                          Menyusun insight…
                        </span>
                      ) : (
                        <Markdown text={m.content} renderCode={ideaRenderer()} />
                      )}
                    </div>

                    {m.showOrchestrator && <OrchestratorCard sessionId={m.id} />}
                    {m.orchestrator && <OrchestratorCard sessionId={m.id} preset={m.orchestrator} />}
                    {m.scopeAsk && (
                      <ScopeDialog sessionId={m.id} topic={m.scopeAsk.topic} time={m.scopeAsk.time} publish={m.scopeAsk.publish ?? null} />
                    )}
                    {m.drafts && m.drafts.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {m.drafts.map((d, di) => (
                          <DraftCard key={d.id} draft={d} index={m.drafts && m.drafts.length > 1 ? di + 1 : undefined} />
                        ))}
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-3 text-xs text-faint">
                      <span>{m.time}</span>
                      {m.isError ? (
                        isLast && (
                          <button
                            type="button"
                            onClick={retry}
                            disabled={isLoading}
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline cursor-pointer"
                          >
                            <RotateCw className="w-3 h-3" />
                            Coba lagi
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => copy(m)}
                          className="inline-flex items-center gap-1 hover:text-fg cursor-pointer transition-colors"
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="w-3 h-3 text-success" />
                              Tersalin
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Salin
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {isLoading && !messages.at(-1)?.pending && (
            <div className="flex gap-3" aria-live="polite">
              <div className="w-7 h-7 rounded-full bg-accent-soft text-accent flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div className="flex items-center gap-2 h-7 text-sm text-muted">
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </span>
                Menganalisis data…
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* Tombol aksi cepat */}
      {!isEmpty && (
        <div className="px-4 pt-2 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {quickActions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => submit(a.prompt)}
              disabled={isLoading}
              className="shrink-0 h-8 px-3 rounded-full border border-line bg-surface hover:border-accent hover:text-accent text-[13px] font-medium text-muted transition-colors cursor-pointer disabled:opacity-50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Kolom tulis pesan */}
      <div className="px-4 pb-4 pt-2">
        <div className={cn("mx-auto w-full", compact ? "" : "max-w-3xl")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-end gap-2 p-1.5 pl-5 rounded-[1.75rem] bg-surface border border-line-strong shadow-[0_2px_10px_-4px_rgba(20,23,43,0.12)] transition-all focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                resizeInput();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Tanya apa saja soal performa akun…"
              aria-label="Pertanyaan untuk asisten AI"
              className="flex-1 resize-none bg-transparent border-0 py-2.5 text-sm leading-relaxed text-fg placeholder-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0 max-h-40"
            />
            <button
              type="submit"
              disabled={isLoading || !draft.trim()}
              aria-label="Kirim"
              className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer bg-accent text-on-accent shadow-md shadow-accent/30 hover:bg-accent-hover hover:scale-105 active:scale-95 disabled:bg-subtle disabled:text-faint disabled:shadow-none disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2.4} />
            </button>
          </form>
          {!compact && (
            <p className="mt-2 text-center text-xs text-faint">
              Enter untuk kirim · Shift + Enter untuk baris baru. AI bisa keliru,
              cek angka penting di dasbor.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}



