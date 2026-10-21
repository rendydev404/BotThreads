"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Database,
  MessageSquarePlus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown, type CodeRenderer } from "./markdown";
import { IdeaCard } from "./idea-card";
import { PromptBlock, RolePromptCard } from "./role-prompt-card";
import { ScopeDialog } from "./scope-dialog";
import { IDEA_LANG, ideaPlainText, parseIdea } from "@/lib/idea-block";
import { richBlocksPlainText } from "@/lib/rich-blocks";
import { OrchestratorCard } from "@/components/orchestrator/orchestrator-card";
import type { ChatApi, ChatMessage } from "./use-chat";
import { followUpsFor, suggestionGroups } from "./suggestions";
import { ReportCard } from "./report-card";
import { DraftCard } from "@/components/content/draft-card";
import { ActionPlanCard } from "./action-plan-card";

/** Blok ```ide pada jawaban asisten dirender sebagai kartu ide bernomor urut. */
function ideaRenderer(): CodeRenderer {
  return function renderIdea(lang, code, _key, ordinal) {
    if (lang === "prompt") return <PromptBlock text={code} />;
    if (lang !== IDEA_LANG) return null;
    const idea = parseIdea(code);
    return idea ? <IdeaCard idea={idea} index={ordinal} /> : null;
  };
}

const MAX_INPUT = 4000;

const TONE: Record<"accent" | "success" | "warning", string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
};

function Avatar({ error = false, size = "md" }: { error?: boolean; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0",
        size === "md" ? "w-8 h-8" : "w-7 h-7",
        error
          ? "bg-danger-soft text-danger"
          : "bg-gradient-to-br from-accent to-violet-500 text-on-accent shadow-sm shadow-accent/30"
      )}
    >
      <Sparkles className={size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} />
    </div>
  );
}

const STAGES = ["Mengambil data akun…", "Menghitung insight jaringan…", "Menyusun jawaban…"];

/** Indikator berpikir: label berganti per tahap supaya terasa bergerak, bukan macet. */
function Thinking({ stages = STAGES }: { stages?: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, stages.length - 1)), 2400);
    return () => clearInterval(t);
  }, [stages.length]);

  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-muted" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="w-1.5 h-1.5 rounded-full bg-accent/70 animate-bounce"
            style={{ animationDelay: `${d * 140}ms` }}
          />
        ))}
      </span>
      <span key={i} className="msg-in">
        {stages[i]}
      </span>
    </span>
  );
}

interface ChatPanelProps {
  chat: ChatApi;
  /** Mode ringkas untuk jendela bubble */
  compact?: boolean;
  className?: string;
}

export function ChatPanel({ chat, compact = false, className }: ChatPanelProps) {
  const { messages, isLoading, send, retry, regenerate, summarize, reset } = chat;
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = messages.length === 0;
  const last = messages.at(-1);
  const followUps = useMemo(() => followUpsFor(last), [last]);

  // Jawaban baru: tampilkan dari awalnya (bukan lompat ke dasar); pesan pengguna: ke dasar.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !last) return;
    if (last.role === "assistant") {
      const el = box.querySelector<HTMLElement>(`[data-msg-id="${last.id}"]`);
      if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: "smooth" });
    } else {
      box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    }
    // Hanya saat jumlah pesan atau status muat berubah, bukan tiap pembaruan isi pesan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, isLoading]);

  useEffect(() => {
    if (!compact) inputRef.current?.focus();
  }, [compact]);

  const onScroll = () => {
    const box = scrollRef.current;
    if (!box) return;
    setShowJump(box.scrollHeight - box.scrollTop - box.clientHeight > 160);
  };

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
      await navigator.clipboard.writeText(richBlocksPlainText(ideaPlainText(m.content)));
      setCopiedId(m.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* clipboard tidak tersedia */
    }
  };

  return (
    <div className={cn("flex flex-col min-h-0 h-full", className)}>
      {/* Bilah percakapan */}
      {!isEmpty && (
        <div className="px-4 h-11 shrink-0 border-b border-line flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted min-w-0">
            <Database className="w-3.5 h-3.5 text-success shrink-0" />
            <span className="truncate">Jawaban dari data real di database</span>
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={isLoading}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-muted hover:text-fg hover:bg-subtle transition-colors cursor-pointer disabled:opacity-40 shrink-0"
          >
            <MessageSquarePlus className="w-4 h-4" />
            Percakapan baru
          </button>
        </div>
      )}

      {/* Percakapan */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={onScroll} className="relative h-full overflow-y-auto scroll-smooth">
          <div className={cn("mx-auto w-full px-4 py-5 space-y-6", compact ? "" : "max-w-3xl")}>
            {isEmpty ? (
              <div className={cn("msg-in", compact ? "pt-1" : "pt-6")}>
                <div className="text-center">
                  <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-accent to-violet-500 text-on-accent flex items-center justify-center shadow-lg shadow-accent/25">
                    <Sparkles className="w-7 h-7" />
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-fg">Tanya apa saja soal akun Threads</h3>
                  <p className="mt-1.5 text-sm text-muted">
                    Analisis performa, cari penyebab, atau minta draf siap posting.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-subtle">
                      <Database className="w-3.5 h-3.5 text-success" />
                      Data live semua akun
                    </span>
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-subtle">
                      <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                      Angka diverifikasi
                    </span>
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-subtle">
                      <Zap className="w-3.5 h-3.5 text-warning" />
                      Draf siap jadwalkan
                    </span>
                  </div>
                </div>

                <div className={cn("mt-7 grid gap-x-4 gap-y-5", compact ? "" : "md:grid-cols-2")}>
                  {suggestionGroups.map((g, gi) => (
                    <section
                      key={g.title}
                      className={cn(!compact && gi === suggestionGroups.length - 1 && "md:col-span-2")}
                    >
                      <h4 className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                        {g.title}
                      </h4>
                      <div
                        className={cn(
                          "grid gap-2",
                          !compact && gi === suggestionGroups.length - 1 && "md:grid-cols-2"
                        )}
                      >
                        {g.items.map((s) => (
                          <button
                            key={s.label}
                            type="button"
                            onClick={() => submit(s.prompt)}
                            className="group flex items-center gap-3 p-3 rounded-xl border border-line bg-surface text-left transition-all cursor-pointer hover:border-accent hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <span
                              className={cn(
                                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                TONE[g.tone]
                              )}
                            >
                              <s.icon className="w-[18px] h-[18px]" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-fg truncate">{s.label}</span>
                              <span className="block text-xs text-muted truncate">{s.hint}</span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-faint shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <p className="mt-6 text-center text-xs text-faint">
                  Tips: sebut <span className="font-semibold text-muted">@akun</span> untuk analisis satu akun, atau
                  tulis sendiri pertanyaannya di bawah.
                </p>
              </div>
            ) : (
              messages.map((m, i) => {
                const isUser = m.role === "user";
                const isLast = i === messages.length - 1;

                if (isUser) {
                  return (
                    <div key={m.id} data-msg-id={m.id} className="flex justify-end msg-in">
                      <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-accent text-on-accent text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={m.id} data-msg-id={m.id} className="flex gap-3 msg-in">
                    <div className="mt-0.5">
                      <Avatar error={m.isError} />
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
                          m.isError ? "rounded-xl bg-danger-soft px-3.5 py-3 text-danger" : "text-fg"
                        )}
                      >
                        {m.pending ? (
                          <Thinking
                            stages={
                              m.kind === "execution"
                                ? ["Merangkum hasil eksekusi…", "Menyusun penutup…"]
                                : ["Menyusun insight…", "Membandingkan dengan periode lalu…"]
                            }
                          />
                        ) : (
                          <Markdown text={m.content} renderCode={ideaRenderer()} />
                        )}
                      </div>

                      {m.showOrchestrator && <OrchestratorCard sessionId={m.id} />}
                      {m.orchestrator && <OrchestratorCard sessionId={m.id} preset={m.orchestrator} />}
                      {m.scopeAsk && (
                        <ScopeDialog
                          sessionId={m.id}
                          topic={m.scopeAsk.topic}
                          time={m.scopeAsk.time}
                          publish={m.scopeAsk.publish ?? null}
                        />
                      )}
                      {m.rolePrompt && <RolePromptCard profile={m.rolePrompt} />}
                      {m.plan && <ActionPlanCard sessionId={m.id} plan={m.plan} onFinished={summarize} />}
                      {m.drafts && m.drafts.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {m.drafts.map((d, di) => (
                            <DraftCard
                              key={d.id}
                              draft={d}
                              index={m.drafts && m.drafts.length > 1 ? di + 1 : undefined}
                            />
                          ))}
                        </div>
                      )}

                      {!m.pending && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-faint -ml-1.5">
                          <span className="px-1.5">{m.time}</span>
                          {m.isError ? (
                            isLast && (
                              <button
                                type="button"
                                onClick={retry}
                                disabled={isLoading}
                                className="h-7 px-2 inline-flex items-center gap-1 rounded-md font-medium text-accent hover:bg-accent-soft cursor-pointer disabled:opacity-40"
                              >
                                <RotateCw className="w-3 h-3" />
                                Coba lagi
                              </button>
                            )
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => copy(m)}
                                className="h-7 px-2 inline-flex items-center gap-1 rounded-md hover:text-fg hover:bg-subtle cursor-pointer transition-colors"
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
                              {isLast && (
                                <button
                                  type="button"
                                  onClick={regenerate}
                                  disabled={isLoading}
                                  className="h-7 px-2 inline-flex items-center gap-1 rounded-md hover:text-fg hover:bg-subtle cursor-pointer transition-colors disabled:opacity-40"
                                >
                                  <RotateCw className="w-3 h-3" />
                                  Buat ulang
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {isLoading && !last?.pending && last?.role === "user" && (
              <div className="flex gap-3 msg-in" aria-live="polite">
                <Avatar />
                <div className="flex items-center h-8">
                  <Thinking />
                </div>
              </div>
            )}
          </div>
        </div>

        {showJump && !isEmpty && (
          <button
            type="button"
            onClick={() =>
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
            }
            aria-label="Ke pesan terbaru"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 h-9 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-surface border border-line-strong text-xs font-medium text-fg shadow-pop hover:border-accent hover:text-accent transition-colors cursor-pointer msg-in"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Pesan terbaru
          </button>
        )}
      </div>

      {/* Saran lanjutan sesuai isi jawaban terakhir */}
      {!isEmpty && !isLoading && (
        <div className="px-4 pt-2 shrink-0">
          <div
            className={cn(
              "mx-auto w-full flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              compact ? "" : "max-w-3xl"
            )}
          >
            {followUps.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => submit(f.prompt)}
                className="shrink-0 h-8 px-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface hover:border-accent hover:bg-accent-soft hover:text-accent text-[13px] font-medium text-muted transition-colors cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Kolom tulis pesan */}
      <div className="px-4 pb-4 pt-2 shrink-0">
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
              maxLength={MAX_INPUT}
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
              placeholder={
                isEmpty ? "Tanya apa saja soal performa akun…" : "Tulis pertanyaan lanjutan…"
              }
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
          <p className="mt-2 flex items-center justify-center gap-2 text-center text-xs text-faint">
            {draft.length > MAX_INPUT * 0.8 ? (
              <span className={draft.length >= MAX_INPUT ? "text-danger" : "text-warning"}>
                {draft.length.toLocaleString("id-ID")} / {MAX_INPUT.toLocaleString("id-ID")} karakter
              </span>
            ) : compact ? (
              <span>AI bisa keliru, cek angka penting di dasbor.</span>
            ) : (
              <span>
                Enter untuk kirim · Shift + Enter untuk baris baru · AI bisa keliru, cek angka penting di dasbor.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
