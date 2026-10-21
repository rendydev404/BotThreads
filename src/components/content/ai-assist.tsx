"use client";

import React, { useRef, useState } from "react";
import { ArrowUp, Lightbulb, RotateCcw, Scissors, Smile, Sparkles, Square, Wand2, Zap } from "lucide-react";
import { AgentSteps, HumanScore, TypeReveal, useStagedSteps } from "@/components/ai/agent-ui";
import { aiEditPost, type EditAction, type EditResult } from "@/lib/ai-client";
import { ContentApiError } from "@/lib/content-client";
import { cn } from "@/lib/utils";

const QUICK: { action: Exclude<EditAction, "custom">; label: string; icon: React.ElementType }[] = [
  { action: "humanize", label: "Lebih manusiawi", icon: Wand2 },
  { action: "hook", label: "Hook nendang", icon: Zap },
  { action: "casual", label: "Lebih santai", icon: Smile },
  { action: "shorter", label: "Lebih singkat", icon: Scissors },
  { action: "idea", label: "Ide baru dari tren", icon: Lightbulb },
];

const REVISE_STEPS = [
  { key: "profil", label: "Membaca Profil AI & gaya akun" },
  { key: "ingat", label: "Mengingat pelajaran dari koreksi Anda" },
  { key: "tulis", label: "Menulis ulang beberapa versi" },
  { key: "saring", label: "Menyaring yang terdengar seperti AI" },
];
const IDEA_STEPS = [
  { key: "tren", label: "Membuka bank ide & tren niche akun" },
  { key: "profil", label: "Membaca Profil AI & gaya akun" },
  { key: "tulis", label: "Menulis postingan baru" },
  { key: "saring", label: "Menyaring yang terdengar seperti AI" },
];

interface AiAssistProps {
  postId: string;
  handle: string;
  /** Teks di editor saat ini (bisa belum disimpan). */
  text: string;
  disabled?: boolean;
  onApply: (text: string, topicTag: string | null) => void;
}

/**
 * Asisten AI di modal edit postingan: revisi sekali klik atau dengan arahan bebas, dan ide baru dari tren
 * niche akun. AI memakai Profil AI + memori gaya akun; hasil tidak disimpan sampai pengguna menekan Simpan.
 */
export function AiAssist({ postId, handle, text, disabled, onApply }: AiAssistProps) {
  const [running, setRunning] = useState<EditAction | null>(null);
  const [result, setResult] = useState<EditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const steps = useStagedSteps(running === "idea" ? IDEA_STEPS : REVISE_STEPS, running !== null);

  const run = async (action: EditAction) => {
    if (running) return;
    abort.current = new AbortController();
    setRunning(action);
    setError(null);
    setResult(null);
    setApplied(null);
    try {
      const res = await aiEditPost(
        postId,
        { action, text, ...(action === "custom" ? { instruction: instruction.trim() } : {}) },
        abort.current.signal
      );
      setResult(res);
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || abort.current?.signal.aborted) return;
      setError(e instanceof ContentApiError ? e.message : "AI sedang sibuk. Coba lagi sebentar lagi.");
    } finally {
      setRunning(null);
    }
  };

  const used = result?.used;
  const usedLine = used
    ? [
        used.role ? "Profil AI" : null,
        used.lessons ? `${used.lessons} pelajaran gaya` : null,
        used.samples ? `${used.samples} contoh postingan` : null,
        used.facts ? `${used.facts} fakta brand` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <section className={cn("ai-aura rounded-2xl bg-surface p-3.5", !running && "ai-aura-idle")} aria-label="Asisten AI">
      <header className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet-500 text-white shadow-sm shadow-accent/30">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-fg">Asisten AI</p>
          <p className="truncate text-[11px] text-muted">Menulis dengan gaya @{handle}, bukan gaya AI</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            disabled={disabled || !!running}
            onClick={() => run(action)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer disabled:cursor-not-allowed",
              running === action
                ? "border-accent bg-accent text-on-accent"
                : "border-line bg-subtle text-fg hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <form
        className="mt-2.5 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim()) run("custom");
        }}
      >
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value.slice(0, 300))}
          disabled={disabled || !!running}
          placeholder='Atau tulis arahan, mis. "tambahin cerita kecil pas begadang"'
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-subtle px-3.5 text-xs text-fg placeholder-faint focus:border-accent focus:bg-surface focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Kirim arahan ke AI"
          disabled={disabled || !!running || !instruction.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-40 cursor-pointer"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>

      {running && (
        <div className="msg-in mt-3.5 rounded-xl bg-subtle/70 p-3">
          <AgentSteps steps={steps} compact />
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted hover:text-danger cursor-pointer"
          >
            <Square className="h-3 w-3" /> Hentikan
          </button>
        </div>
      )}

      {error && <p className="msg-in mt-3 rounded-xl bg-danger-soft p-2.5 text-xs font-medium text-danger">{error}</p>}

      {result && !running && (
        <div className="mt-3.5 space-y-2">
          {result.idea && (
            <p className="msg-in rounded-xl bg-warning-soft px-3 py-2 text-[11px] font-medium text-warning">
              Ide dari bank ide: <span className="font-bold">{result.idea.topik}</span>
            </p>
          )}
          <p className="text-[11px] text-muted">
            {result.candidates.length} versi{usedLine ? ` · memakai ${usedLine}` : ""}
          </p>
          {result.candidates.map((c, i) => {
            const isApplied = applied === c.id;
            return (
              <article
                key={c.id}
                className={cn(
                  "msg-in rounded-xl border p-3 transition-colors",
                  isApplied ? "border-success bg-success-soft/40" : "border-line bg-surface hover:border-accent/60"
                )}
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  <HumanScore score={c.humanScore} tells={c.tells} />
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-muted">{c.angle}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-fg">
                  <TypeReveal text={c.text} />
                </p>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onApply(c.text, c.topicTag);
                      setApplied(c.id);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      isApplied ? "bg-success text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-on-accent"
                    )}
                  >
                    {isApplied ? "Dipakai" : "Pakai versi ini"}
                  </button>
                </div>
              </article>
            );
          })}
          <button
            type="button"
            onClick={() => setResult(null)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted hover:text-fg cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" /> Tutup saran
          </button>
        </div>
      )}
    </section>
  );
}
