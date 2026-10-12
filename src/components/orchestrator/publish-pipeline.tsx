"use client";

import React, { useMemo } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, CircleSlash, ExternalLink, Hourglass, PenLine, Radio, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatWibLabel } from "@/lib/scheduling";
import type { PostItemDTO } from "@/lib/content-types";
import { AccountAvatar } from "@/components/content/post-status-chip";
import { usePostStatusPoll } from "@/components/content/use-post-status-poll";
import type { AgentState, OrchestratorState, ReviewItem } from "./orchestrator-store";

/** 0 menunggu, 1 menulis, 2 antre, 3 terbit/terjadwal; -1 gagal, -2 dilewati. */
type Stage = -2 | -1 | 0 | 1 | 2 | 3;

function stageOf(agent: AgentState, item: ReviewItem | undefined, live: PostItemDTO | undefined, mode: "now" | "schedule"): Stage {
  if (agent.status === "SKIPPED") return -2;
  if (agent.status === "ERROR" || item?.status === "FAILED" || live?.status === "FAILED") return -1;
  if (agent.status === "PENDING") return 0;
  if (agent.status === "THINKING" || agent.status === "RETRYING" || !item) return 1;
  if (item.status !== "SCHEDULED") return 2;
  if (mode === "schedule") return 3;
  return live?.status === "PUBLISHED" ? 3 : 2;
}

const STEPS = [
  { icon: PenLine, label: "Tulis" },
  { icon: Hourglass, label: "Antre" },
  { icon: Rocket, label: "Terbit" },
] as const;

function Stepper({ stage, mode }: { stage: Stage; mode: "now" | "schedule" }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {STEPS.map((s, i) => {
        const step = i + 1; // 1 tulis, 2 antre, 3 terbit
        const done = stage > step || (stage === 3 && step === 3);
        const current = stage === step && !(stage === 3);
        const failed = stage === -1 && step === 1;
        const Icon = step === 3 && mode === "schedule" ? CalendarClock : s.icon;
        return (
          <React.Fragment key={s.label}>
            {i > 0 && (
              <span className={cn("h-0.5 w-3 rounded-full transition-colors duration-500", stage >= step ? "bg-success" : "bg-line")} />
            )}
            <span
              className={cn(
                "relative w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-500",
                done ? "bg-success text-on-accent" : current ? "bg-accent text-on-accent" : failed ? "bg-danger text-on-accent" : "bg-subtle text-faint"
              )}
            >
              {current && <span className="absolute inset-0 rounded-full bg-accent/50 animate-ping" />}
              <Icon className="relative w-3 h-3" />
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Stat({ label, value, total, tone, icon: Icon }: { label: string; value: number; total: number; tone: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <Icon className={cn("w-4 h-4", tone.replace("bg-", "text-"))} />
      </div>
      <p className="mt-1 text-2xl font-bold text-fg tabular-nums">{value}</p>
      <div className="mt-2 h-1 rounded-full bg-subtle overflow-hidden">
        <div className={cn("h-full rounded-full transition-[width] duration-700", tone)} style={{ width: `${total ? (value / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

/**
 * Tampilan langsung posting otomatis: angka per tahap, bar progres bertumpuk, dan jalur tiap akun
 * (tulis -> antre -> terbit). Status terbit dipantau dari antrean (polling 5 detik, per 20 id).
 */
export function PublishPipeline({ state }: { state: OrchestratorState }) {
  const publish = state.config.publish!;
  const mode = publish.mode;
  const items = useMemo(() => new Map(state.items.map((i) => [i.accountId, i])), [state.items]);
  const liveIds = mode === "now" ? state.items.filter((i) => i.status === "SCHEDULED" && i.postId).map((i) => i.postId!) : [];
  const live = usePostStatusPoll(liveIds);

  const rows = state.agents.map((a) => {
    const item = items.get(a.id);
    const post = item?.postId ? live[item.postId] : undefined;
    return { agent: a, item, post, stage: stageOf(a, item, post, mode) };
  });
  const total = rows.filter((r) => r.stage !== -2).length;
  const count = (fn: (s: Stage) => boolean) => rows.filter((r) => fn(r.stage)).length;
  const writing = count((s) => s === 0 || s === 1);
  const queued = count((s) => s === 2);
  const done = count((s) => s === 3);
  const failed = count((s) => s === -1);
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const finished = !state.running && writing === 0 && queued === 0;

  const when =
    mode === "now"
      ? "Posting sekarang"
      : `Jadwal ${publish.dayOffset === 1 ? "besok" : publish.dayOffset === 2 ? "lusa" : publish.dayOffset === 0 ? "hari ini" : "terdekat"}${
          publish.hourWib !== null ? ` · ${String(publish.hourWib).padStart(2, "0")}:00 WIB` : " · jam ramai tiap akun"
        }`;

  return (
    <section className="rounded-2xl border border-line bg-surface overflow-hidden" aria-live="polite">
      <div className="relative px-4 py-3 bg-gradient-to-r from-accent/15 via-accent-soft/60 to-success/10 border-b border-line">
        <div className="flex items-center gap-3">
          <span className="relative flex w-9 h-9 items-center justify-center rounded-xl bg-accent text-on-accent shrink-0">
            {!finished && <span className="absolute inset-0 rounded-xl bg-accent/40 animate-ping" />}
            {finished ? <CheckCircle2 className="relative w-5 h-5" /> : <Radio className="relative w-5 h-5" />}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold text-fg">
              {finished ? "Posting otomatis selesai" : "Posting otomatis berjalan"} · {total} akun
            </p>
            <p className="text-xs text-muted">{when}</p>
          </div>
          <span className="ml-auto text-xs font-semibold text-accent tabular-nums">
            {done}/{total}
          </span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-surface/70 overflow-hidden flex" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="h-full bg-success transition-[width] duration-700" style={{ width: pct(done) }} />
          <div className="h-full bg-accent transition-[width] duration-700" style={{ width: pct(queued) }} />
          <div className="h-full bg-danger transition-[width] duration-700" style={{ width: pct(failed) }} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 @lg:grid-cols-4 gap-2">
          <Stat label="Menulis" value={writing} total={total} tone="bg-accent" icon={PenLine} />
          <Stat label={mode === "now" ? "Di antrean" : "Diantrekan"} value={queued} total={total} tone="bg-warning" icon={Hourglass} />
          <Stat label={mode === "now" ? "Terbit" : "Terjadwal"} value={done} total={total} tone="bg-success" icon={mode === "now" ? Rocket : CalendarClock} />
          <Stat label="Gagal" value={failed} total={total} tone="bg-danger" icon={AlertCircle} />
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted">Menyiapkan agen untuk tiap akun…</p>
        ) : (
          <ul className="grid grid-cols-1 @lg:grid-cols-2 @3xl:grid-cols-3 gap-2 max-h-[40vh] overflow-y-auto pr-1">
            {rows.map(({ agent, item, post, stage }) => {
              const note =
                stage === -2
                  ? agent.error ?? "Belum siap"
                  : stage === -1
                    ? item?.error ?? post?.pesanError ?? agent.error ?? "Gagal"
                    : stage === 3 && item
                      ? mode === "now"
                        ? "Sudah terbit"
                        : `${formatWibLabel(new Date(item.at))}${item.movedFrom ? " · digeser otomatis" : ""}`
                      : stage === 2
                        ? mode === "now"
                          ? "Menunggu worker"
                          : "Masuk antrean"
                        : stage === 1
                          ? "Agen menulis"
                          : "Menunggu giliran";
              return (
                <li
                  key={agent.id}
                  title={note}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors duration-500",
                    stage === 3 ? "border-success/40 bg-success-soft/30" : stage === -1 ? "border-danger/40 bg-danger-soft/30" : stage === -2 ? "border-line bg-subtle opacity-60" : "border-line"
                  )}
                >
                  <AccountAvatar name={agent.displayName} src={agent.avatarUrl} size="w-8 h-8" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-[13px] font-semibold text-fg truncate">@{agent.username ?? agent.displayName}</p>
                    <p className={cn("text-[11px] truncate", stage === -1 ? "text-danger" : "text-muted")}>{note}</p>
                  </div>
                  {stage === -2 ? (
                    <CircleSlash className="w-4 h-4 text-muted shrink-0" />
                  ) : post?.releaseUrl ? (
                    <a href={post.releaseUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline shrink-0" aria-label="Lihat di Threads">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  ) : (
                    <Stepper stage={stage} mode={mode} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
