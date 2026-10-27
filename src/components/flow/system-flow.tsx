"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Hand, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { FLOW_STEPS, type FlowStep, type FlowStepId } from "@/lib/system-flow";
import { STEP_ICONS } from "./step-icons";
import { useT } from "@/components/i18n/lang-provider";

/** Kerangka seukuran diagram selagi React Flow diunduh, supaya tata letak tidak meloncat. */
function CanvasSkeleton() {
  return (
    <div className="h-[470px] w-full grid grid-cols-[1fr_3fr] gap-6 p-2" aria-hidden>
      <div className="rounded-3xl border border-dashed border-line animate-pulse" />
      <div className="rounded-3xl border border-dashed border-line animate-pulse" />
    </div>
  );
}

// React Flow (~50 KB gzip) hanya diunduh di layar lebar dan saat diagram mendekati layar.
const FlowCanvas = dynamic(() => import("./flow-canvas"), { ssr: false, loading: CanvasSkeleton });

function ByChip({ step, className }: { step: FlowStep; className?: string }) {
  const auto = step.by === "otomatis";
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-bold whitespace-nowrap",
        auto ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning",
        className
      )}
    >
      {auto ? <Bot className="w-3.5 h-3.5" /> : <Hand className="w-3.5 h-3.5" />}
      {auto ? t("Otomatis") : t("Anda")}
    </span>
  );
}

/** Isi rinci satu langkah: dipakai panel desktop dan daftar ponsel. */
function StepBody({ step, variant }: { step: FlowStep; variant: "landing" | "app" }) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-bold text-muted">{t("Yang terjadi")}</p>
        <p className="mt-1 text-sm text-fg leading-relaxed">{t(step.what)}</p>
      </div>
      <div>
        <p className="text-xs font-bold text-muted">{t("Yang perlu Anda lakukan")}</p>
        <p className="mt-1 text-sm text-fg leading-relaxed">{t(step.you ?? "Tidak ada, berjalan sendiri.")}</p>
        {variant === "app" ? (
          <Link
            href={step.href}
            className="mt-3 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold transition-colors"
          >
            {t("Buka {menu}", { menu: t(step.menu) })}
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <p className="mt-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-subtle text-xs font-semibold text-fg">
            {t("Di aplikasi: menu {menu}", { menu: t(step.menu) })}
          </p>
        )}
      </div>
    </div>
  );
}

export interface SystemFlowProps {
  variant: "landing" | "app";
  /** Langkah yang sudah dikerjakan pengguna (hanya di aplikasi). */
  doneIds?: FlowStepId[];
}

export function SystemFlow({ variant, doneIds = [] }: SystemFlowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  const [wide, setWide] = useState(false);
  const [near, setNear] = useState(false);
  const firstOpen = FLOW_STEPS.find((s) => !doneIds.includes(s.id))?.id ?? "hubungkan";
  const [selectedId, setSelectedId] = useState<FlowStepId>(firstOpen);
  const onSelect = useCallback((id: FlowStepId) => setSelectedId(id), []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "300px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const idx = FLOW_STEPS.findIndex((s) => s.id === selectedId);
  const step = FLOW_STEPS[idx];
  const Icon = STEP_ICONS[step.id];

  return (
    <div ref={ref}>
      {/* Layar lebar: diagram interaktif + panel rincian langkah yang dipilih. */}
      <div className="hidden lg:block">
        <div className="rounded-3xl border border-line bg-canvas p-3">
          {wide && near ? <FlowCanvas selectedId={selectedId} doneIds={doneIds} onSelect={onSelect} /> : <CanvasSkeleton />}
        </div>
        <div className="mt-4 rounded-3xl border border-line bg-surface p-6" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={cn(
                  "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                  step.by === "otomatis" ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
                )}
              >
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-muted">
                  {t("Langkah {no} dari {total}", { no: step.no, total: FLOW_STEPS.length })}
                </p>
                <h3 className="text-lg font-bold text-fg leading-tight">{t(step.title)}</h3>
              </div>
              <ByChip step={step} className="ml-1" />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedId(FLOW_STEPS[Math.max(0, idx - 1)].id)}
                disabled={idx === 0}
                aria-label={t("Langkah sebelumnya")}
                className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-fg hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedId(FLOW_STEPS[Math.min(FLOW_STEPS.length - 1, idx + 1)].id)}
                disabled={idx === FLOW_STEPS.length - 1}
                aria-label={t("Langkah berikutnya")}
                className="w-9 h-9 rounded-lg border border-line flex items-center justify-center text-fg hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="mt-5">
            <StepBody step={step} variant={variant} />
          </div>
        </div>
      </div>

      {/* Ponsel & tablet: daftar berurutan yang bisa dibuka. Teks lengkapnya juga ada di HTML awal. */}
      <ol className="lg:hidden space-y-3">
        {FLOW_STEPS.map((s, i) => {
          const SIcon = STEP_ICONS[s.id];
          const done = doneIds.includes(s.id);
          return (
            <li key={s.id}>
              {i === 2 && (
                <p className="mb-3 mt-1 text-[11px] font-bold tracking-widest text-accent">{t("OTOMATIS · SETIAP HARI")}</p>
              )}
              {i === 0 && <p className="mb-3 text-[11px] font-bold tracking-widest text-warning">{t("ANDA · SEKALI DI AWAL")}</p>}
              <details className="group rounded-2xl border border-line bg-surface" open={s.id === firstOpen}>
                <summary className="flex items-center gap-3 p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                      s.by === "otomatis" ? "bg-accent-soft text-accent" : "bg-warning-soft text-warning"
                    )}
                  >
                    <SIcon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-xs font-bold text-faint">
                      {t("Langkah {no}", { no: s.no })}
                      {done && (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CircleCheck className="w-3.5 h-3.5" />
                          {t("Selesai")}
                        </span>
                      )}
                    </span>
                    <span className="block text-[15px] font-bold text-fg leading-snug">{t(s.title)}</span>
                    <span className="block text-[13px] text-muted leading-snug">{t(s.short)}</span>
                  </span>
                  <ChevronDown className="w-5 h-5 text-muted shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-4 pt-1">
                  <ByChip step={s} className="mb-3" />
                  <StepBody step={s} variant={variant} />
                </div>
              </details>
            </li>
          );
        })}
        <li className="flex items-center gap-2 px-1 text-[13px] font-semibold text-accent">
          <Repeat className="w-4 h-4 shrink-0" />
          {t("Hasil langkah 6 jadi bahan ide besok, lalu siklusnya berulang setiap hari.")}
        </li>
      </ol>
    </div>
  );
}
