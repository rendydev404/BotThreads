"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentStepStatus = "pending" | "active" | "done" | "skipped" | "failed";

export interface AgentStepView {
  key: string;
  label: string;
  status: AgentStepStatus;
  detail?: string | null;
  items?: string[];
}

/** Timeline langkah agen: langkah aktif berdenyut dan teksnya berkilau, langkah selesai "meletup" hijau. */
export function AgentSteps({ steps, compact = false }: { steps: AgentStepView[]; compact?: boolean }) {
  return (
    <ol className="relative space-y-0" aria-live="polite">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.key} className="ai-step-in relative flex gap-3 pb-3 last:pb-0" style={{ animationDelay: `${i * 70}ms` }}>
            {!last && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[11px] top-6 bottom-0 w-px transition-colors duration-500",
                  s.status === "done" ? "bg-success/50" : "bg-line"
                )}
              />
            )}
            <StepIcon status={s.status} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={cn(
                  "text-[13px] font-semibold leading-snug",
                  s.status === "active" ? "ai-shimmer-text" : s.status === "pending" ? "text-faint" : "text-fg"
                )}
              >
                {s.label}
              </p>
              {s.detail && !compact && (
                <p className={cn("msg-in mt-0.5 text-xs leading-relaxed", s.status === "failed" ? "text-danger" : "text-muted")}>{s.detail}</p>
              )}
              {!!s.items?.length && !compact && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.items.slice(0, 5).map((it, k) => (
                    <span
                      key={it}
                      className="msg-in max-w-full truncate rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent"
                      style={{ animationDelay: `${k * 90}ms` }}
                      title={it}
                    >
                      {it}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ status }: { status: AgentStepStatus }) {
  const base = "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
  if (status === "active") {
    return (
      <span className={cn(base, "bg-accent text-on-accent")}>
        <span aria-hidden className="absolute inset-0 rounded-full bg-accent/40 animate-ping" />
        <Loader2 className="relative h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className={cn(base, "bg-success text-white animate-[pop-in_220ms_ease-out]")}>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={cn(base, "bg-danger-soft text-danger")}>
        <X className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className={cn(base, "bg-subtle text-faint")}>
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  return <span className={cn(base, "border-2 border-line bg-surface")} />;
}

/**
 * Langkah yang maju sendiri selama satu permintaan berjalan (server tidak mengirim progres per langkah).
 * Langkah terakhir menunggu sampai permintaan benar-benar selesai, jadi tampilan tidak pernah mendahului hasil.
 */
export function useStagedSteps(labels: { key: string; label: string }[], running: boolean, stepMs = 2600): AgentStepView[] {
  const [i, setI] = useState(0);
  const [prevRunning, setPrevRunning] = useState(running);
  if (running !== prevRunning) {
    setPrevRunning(running);
    if (running) setI(0);
  }
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setI((v) => Math.min(v + 1, labels.length - 1)), stepMs);
    return () => clearInterval(t);
  }, [running, labels.length, stepMs]);
  return labels.map((l, k) => ({
    ...l,
    status: !running ? "done" : k < i ? "done" : k === i ? "active" : "pending",
  }));
}

/** Teks yang "diketik" AI huruf demi huruf (langsung tampil penuh bila pengguna memilih gerak minimal). */
export function TypeReveal({ text, speed = 14, className }: { text: string; speed?: number; className?: string }) {
  const [reduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [shown, setShown] = useState(0);
  const [source, setSource] = useState(text);
  if (source !== text) {
    setSource(text);
    setShown(0);
  }
  useEffect(() => {
    if (reduced) return;
    // Teks panjang diketik per beberapa huruf supaya selesai dalam ±1,5 detik.
    const step = Math.max(1, Math.ceil(text.length / (1500 / speed)));
    const t = setInterval(() => {
      setShown((v) => {
        if (v >= text.length) {
          clearInterval(t);
          return v;
        }
        return Math.min(text.length, v + step);
      });
    }, speed);
    return () => clearInterval(t);
  }, [text, speed, reduced]);
  const visible = reduced ? text.length : shown;
  const done = visible >= text.length;
  return (
    <span className={cn("whitespace-pre-wrap", !done && "ai-caret", className)} aria-label={text}>
      {text.slice(0, visible)}
    </span>
  );
}

/** Lencana skor kealamian: hijau = terdengar manusia, kuning = masih ada ciri AI. */
export function HumanScore({ score, tells }: { score: number; tells: string[] }) {
  const good = score >= 85;
  return (
    <span
      title={tells.length ? `Terdeteksi: ${tells.join(", ")}` : "Tidak ada ciri tulisan AI yang terdeteksi"}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
        good ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", good ? "bg-success" : "bg-warning")} />
      Natural {score}
    </span>
  );
}
