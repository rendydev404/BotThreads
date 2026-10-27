"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CircleCheck, Hourglass, Send, Sparkles, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionPlan, ActionPlanTask } from "@/lib/action-plan";
import { OrchestratorCard, type OrchestratorPreset } from "@/components/orchestrator/orchestrator-card";
import {
  useOrchestrator,
  type OrchestratorState,
  type PublishMode,
} from "@/components/orchestrator/orchestrator-store";
import type { Execution, ExecutionAccount, ExecutionTask } from "@/lib/execution-summary";
import { useT } from "@/components/i18n/lang-provider";

/** Sesi yang sudah dirangkum (bertahan selama halaman terbuka) supaya tidak dikirim dua kali. */
const summarized = new Set<string>();

/** Hasil nyata satu tugas dari keadaan orkestrator. */
function toExecutionTask(task: ActionPlanTask, s: OrchestratorState): ExecutionTask {
  const accounts: ExecutionAccount[] = s.agents.map((a) => {
    const it = s.items.find((i) => i.accountId === a.id);
    const status: ExecutionAccount["status"] = it
      ? it.status === "SCHEDULED"
        ? "SCHEDULED"
        : it.status === "FAILED"
          ? "FAILED"
          : "DRAFT"
      : a.status === "SKIPPED"
        ? "SKIPPED"
        : "FAILED";
    return {
      username: a.username ?? a.displayName,
      status,
      at: it?.status === "SCHEDULED" ? it.at : null,
      text: it?.text ?? "",
      error: it?.error ?? a.error ?? null,
      moved: !!it?.movedFrom,
    };
  });
  return { title: task.title, topic: task.topic, accounts };
}

type Choice = "schedule" | "now" | "draft";

const toPublish = (c: Choice): PublishMode | null =>
  c === "draft" ? null : { mode: c, dayOffset: null, hourWib: null };

const taskId = (sessionId: string, index: number) => `${sessionId}:t${index}`;

function AccountChips({ task, readyCount }: { task: ActionPlanTask; readyCount: number }) {
  const t = useT();
  if (task.accountIds === null) {
    return (
      <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-subtle text-xs text-muted">
        <Users className="w-3 h-3" />
        {t("Semua akun siap ({n})", { n: readyCount })}
      </span>
    );
  }
  const shown = task.accountNames.slice(0, 4);
  const rest = task.accountNames.length - shown.length;
  return (
    <>
      {shown.map((n) => (
        <span key={n} className="inline-flex items-center h-6 px-2 rounded-full bg-accent-soft text-xs font-medium text-accent">
          @{n}
        </span>
      ))}
      {rest > 0 && <span className="inline-flex items-center h-6 px-2 rounded-full bg-subtle text-xs text-muted">{t("+{n} akun", { n: rest })}</span>}
    </>
  );
}

/** Satu tugas berjalan setelah tugas sebelumnya selesai, supaya panggilan AI tidak menumpuk. */
function PlanTask({
  index,
  total,
  sessionId,
  task,
  publish,
  onDone,
}: {
  index: number;
  total: number;
  sessionId: string;
  task: ActionPlanTask;
  publish: PublishMode | null;
  onDone: (index: number, result: ExecutionTask) => void;
}) {
  const t = useT();
  const id = taskId(sessionId, index);
  const own = useOrchestrator(id).state;
  const prev = useOrchestrator(index === 0 ? id : taskId(sessionId, index - 1)).state;
  const open = index === 0 || (prev.launched && !prev.running && prev.step === "REVIEW");

  const preset = useMemo<OrchestratorPreset>(
    () => ({ accountIds: task.accountIds, topic: task.topic, time: null, publish }),
    [task.accountIds, task.topic, publish]
  );

  const scheduled = own.items.filter((i) => i.status === "SCHEDULED").length;
  const done = own.launched && !own.running && own.step === "REVIEW";

  // Posting otomatis menulis dan mengantre di aliran yang sama; saat aliran berakhir hasilnya final.
  // Pada mode draf, penjadwalan manual tidak ditunggu: tugas dianggap selesai saat draf jadi.
  const doneRef = useRef(false);
  useEffect(() => {
    if (!done || doneRef.current) return;
    doneRef.current = true;
    onDone(index, toExecutionTask(task, own));
  }, [done, index, task, own, onDone]);
  const status = !open
    ? t("Menunggu tugas sebelumnya")
    : done
      ? scheduled > 0
        ? t("{n} posting masuk antrean", { n: scheduled })
        : own.error
          ? t("Gagal")
          : t("Selesai")
      : t("Sedang dikerjakan…");

  return (
    <li className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-3.5 py-3 flex items-start gap-3">
        <span
          className={cn(
            "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
            done && !own.error ? "bg-success-soft text-success" : "bg-accent-soft text-accent"
          )}
        >
          {done && !own.error ? <CircleCheck className="w-4 h-4" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{task.title}</p>
          <p className="mt-0.5 text-xs text-muted">{status}{total > 1 ? ` · ${t("tugas {i} dari {total}", { i: index + 1, total })}` : ""}</p>
        </div>
      </div>
      {open ? (
        <div className="px-3 pb-1">
          <OrchestratorCard sessionId={id} preset={preset} />
        </div>
      ) : (
        <p className="px-3.5 pb-3 flex items-center gap-2 text-xs text-faint">
          <Hourglass className="w-3.5 h-3.5" />
          {t("Dimulai otomatis setelah tugas sebelumnya selesai.")}
        </p>
      )}
    </li>
  );
}

/**
 * Rencana aksi dari saran asisten. Satu-satunya pertanyaan: kapan diposting (jam ramai sesuai data
 * atau sekarang). Setelah dipilih semuanya berjalan otomatis lewat orkestrator, tanpa pertanyaan lagi.
 */
export function ActionPlanCard({
  sessionId,
  plan,
  onFinished,
}: {
  sessionId: string;
  plan: ActionPlan;
  /** Dipanggil sekali saat semua tugas selesai, berisi hasil nyata untuk dirangkum. */
  onFinished?: (execution: Execution) => void;
}) {
  const t = useT();
  const first = useOrchestrator(taskId(sessionId, 0)).state;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [results, setResults] = useState<Record<number, ExecutionTask>>({});

  // Keputusan bertahan walau panel ditutup: dibaca dari sesi orkestrator tugas pertama.
  const started = choice !== null || first.launched;
  const publish = choice !== null ? toPublish(choice) : first.config.publish;

  const onDone = useMemo(
    () => (index: number, result: ExecutionTask) => setResults((r) => (r[index] ? r : { ...r, [index]: result })),
    []
  );
  useEffect(() => {
    if (!started || summarized.has(sessionId)) return;
    if (Object.keys(results).length < plan.tasks.length) return;
    summarized.add(sessionId);
    onFinished?.({
      publish: publish === null ? "draft" : publish.mode,
      tasks: plan.tasks.map((_, i) => results[i]),
    });
  }, [started, results, plan.tasks, publish, sessionId, onFinished]);

  const options: { choice: Choice; title: string; desc: string; icon: React.ElementType; primary?: boolean }[] =
    plan.publishEnabled
      ? [
          {
            choice: "schedule",
            title: t("Jadwalkan di jam ramai"),
            desc: t("Tiap akun tayang di jam terbaiknya, dihitung dari data performa akun itu."),
            icon: CalendarClock,
            primary: true,
          },
          {
            choice: "now",
            title: t("Posting sekarang"),
            desc: t("Langsung masuk antrean terbit untuk semua tugas."),
            icon: Send,
          },
        ]
      : [
          {
            choice: "draft",
            title: t("Buat draf saja"),
            desc: t("Posting otomatis sedang dimatikan; hasilnya draf yang bisa Anda tinjau."),
            icon: Sparkles,
            primary: true,
          },
        ];

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-line bg-gradient-to-r from-accent-soft/70 to-transparent flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-violet-500 text-on-accent flex items-center justify-center shrink-0">
          <Zap className="w-4 h-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <h3 className="text-sm font-semibold text-fg">{t("Rencana aksi otomatis")}</h3>
          <p className="text-xs text-muted">
            {started
              ? t("Berjalan otomatis, tidak ada pertanyaan lagi.")
              : t("Dikerjakan penuh otomatis setelah Anda memilih waktu posting.")}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {started ? (
          <ol className="space-y-3">
            {plan.tasks.map((task, i) => (
              <PlanTask
                key={i}
                index={i}
                total={plan.tasks.length}
                sessionId={sessionId}
                task={task}
                publish={publish}
                onDone={onDone}
              />
            ))}
          </ol>
        ) : (
          <>
            <ol className="space-y-2.5">
              {plan.tasks.map((task, i) => (
                <li key={i} className="rounded-xl border border-line p-3.5">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-accent-soft text-accent flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">{task.title}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <AccountChips task={task} readyCount={plan.readyCount} />
                      </div>
                      <p className="mt-2 text-[13px] text-fg leading-relaxed">
                        <span className="text-muted">{t("Isi:")} </span>
                        {task.topic}
                      </p>
                      {task.reason && <p className="mt-1 text-xs text-muted">{task.reason}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            <div>
              <p className="text-sm font-semibold text-fg">{t("Kapan diposting?")}</p>
              <p className="text-xs text-muted mt-0.5">
                {t("Cukup pilih satu. Penulisan, jam, dan pengantrean dikerjakan otomatis; tiap posting masih bisa dibatalkan.")}
              </p>
              <div className={cn("mt-3 grid gap-2", options.length > 1 && "sm:grid-cols-2")}>
                {options.map((o) => {
                  const Icon = o.icon;
                  return (
                    <button
                      key={o.choice}
                      type="button"
                      onClick={() => setChoice(o.choice)}
                      className={cn(
                        "text-left rounded-xl border p-3.5 transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-md",
                        o.primary
                          ? "border-accent bg-accent-soft/60 ring-1 ring-accent"
                          : "border-line hover:border-accent"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                        <span
                          className={cn(
                            "w-7 h-7 rounded-full flex items-center justify-center",
                            o.primary ? "bg-accent text-on-accent" : "bg-subtle text-muted"
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </span>
                        {o.title}
                        {o.primary && plan.publishEnabled && (
                          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-accent">
                            {t("Disarankan")}
                          </span>
                        )}
                      </span>
                      <span className="mt-1.5 block text-xs text-muted leading-relaxed">{o.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
