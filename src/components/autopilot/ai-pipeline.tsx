"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clock, Lightbulb, PenLine, RotateCcw, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchSlotWork } from "@/lib/autopilot-client";
import type { AutopilotSlotDTO, SlotStatus, SlotWorkDTO } from "@/lib/autopilot-types";
import { useT } from "@/components/i18n/lang-provider";
import { currentLocale } from "@/lib/i18n/core";

const STEPS = [
  { label: "Mencari ide", icon: Lightbulb },
  { label: "Menyusun konten", icon: PenLine },
  { label: "Review", icon: ShieldCheck },
  { label: "Siap posting", icon: Send },
] as const;

const WRITTEN: SlotStatus[] = ["MENUNGGU_TINJAU", "TERANTRE", "TERBIT"];

const CSS = `
@keyframes aip-in{from{opacity:0;transform:translateY(6px) scale(.96)}to{opacity:1;transform:none}}
@keyframes aip-word{from{opacity:0}to{opacity:1}}
@keyframes aip-bar{0%{transform:scaleX(.15)}60%{transform:scaleX(1)}100%{transform:scaleX(1);opacity:.35}}
@keyframes aip-dot{0%,100%{opacity:1}50%{opacity:.25}}
.aip-off,.aip-off *{animation-play-state:paused!important}
.aip-static *{animation:none!important}
`;

const anim = (name: string, ms: number, delay = 0, extra = "") =>
  ({ animation: `${name} ${ms}ms cubic-bezier(.22,1,.36,1) ${delay}ms both ${extra}`.trim() }) as const;

const hhmm = (iso: string): string =>
  new Date(iso).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/** Lama tiap langkah saat memutar ulang hasil kerja AI (teks panjang diketik lebih cepat, total tetap singkat). */
function stepMs(step: number, work: SlotWorkDTO | null): number {
  if (step === 0) return 2600;
  if (step === 1) return Math.min(4200, 600 + (work?.draft?.text.split(/\s+/).length ?? 20) * 70);
  return 1200 + (work?.draft?.checks.length ?? 3) * 450;
}

type Focus =
  | { mode: "live"; slot: AutopilotSlotDTO }
  | { mode: "result"; slot: AutopilotSlotDTO }
  | { mode: "idle"; slot: AutopilotSlotDTO | null };

/** Apa yang sedang/terakhir dikerjakan AI: slot yang sedang ditulis, lalu hasil terbaru, lalu slot berikutnya. */
function pickFocus(slots: AutopilotSlotDTO[], today: string, lastLive: string | null): Focus {
  const todays = slots.filter((s) => s.dayKey === today).sort((a, b) => a.slotAt.localeCompare(b.slotAt));
  const live = todays.find((s) => s.status === "MENULIS") ?? slots.find((s) => s.status === "MENULIS");
  if (live) return { mode: "live", slot: live };
  const justDone = lastLive ? slots.find((s) => s.id === lastLive && WRITTEN.includes(s.status)) : undefined;
  const written = todays.filter((s) => WRITTEN.includes(s.status));
  const result = justDone ?? written[written.length - 1];
  if (result) return { mode: "result", slot: result };
  const next = [...slots].sort((a, b) => a.slotAt.localeCompare(b.slotAt)).find((s) => s.status === "DIRENCANAKAN") ?? null;
  return { mode: "idle", slot: next };
}

function Stage({ step, focus, work, handle }: { step: number; focus: Focus; work: SlotWorkDTO | null; handle: string }) {
  const t = useT();
  const d = work?.draft ?? null;
  if (focus.mode === "idle")
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
        <Clock className="w-5 h-5 text-muted" aria-hidden />
        <p className="text-[13px] text-fg">
          {focus.slot
            ? t("AI belum bekerja hari ini. Slot berikutnya {handle} jam {time} ditulis menjelang jamnya.", { handle, time: hhmm(focus.slot.slotAt) })
            : t("Belum ada slot yang direncanakan. Nyalakan autopilot di salah satu akun.")}
        </p>
      </div>
    );

  if (focus.mode === "live")
    return (
      <div className="h-full flex flex-col gap-2">
        <p className="text-xs font-semibold text-fg">
          {t("Menulis untuk {handle} · tayang {time}", { handle, time: hhmm(focus.slot.slotAt) })}
          {focus.slot.attempt > 1 && <span className="text-muted font-medium"> · {t("percobaan ke-{n}", { n: focus.slot.attempt })}</span>}
        </p>
        {[96, 88, 70].map((w, i) => (
          <span key={i} className="block h-2.5 rounded bg-accent/25 origin-left" style={{ width: `${w}%`, ...anim("aip-bar", 1600, i * 350, "infinite") }} />
        ))}
        <p className="mt-auto text-[11px] text-muted">{t("Draf muncul di sini begitu AI selesai dan lolos pemeriksaan.")}</p>
      </div>
    );

  if (!work) return <p className="text-xs text-muted">{t("Memuat hasil kerja AI…")}</p>;
  if (!d) return <p className="text-xs text-muted">{t(work.lastError ?? "Draf slot ini tidak tersedia.")}</p>;

  if (step === 0)
    return (
      <div className="h-full flex flex-col justify-center gap-2">
        <div className="flex flex-wrap gap-1.5" style={anim("aip-in", 380)}>
          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-accent text-on-accent text-xs font-semibold shadow-pop">
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            {d.affiliate ? t("Rekomendasi: {name}", { name: d.affiliate }) : d.promo ? "Promo" : (d.topik ?? d.angle ?? t("Ide bebas sesuai gaya akun"))}
          </span>
          {d.pillar && <span className="inline-flex items-center h-8 px-3 rounded-full bg-surface border border-line text-xs font-semibold text-muted">{t("Pilar:")} {d.pillar}</span>}
        </div>
        {d.rationale && (
          <p className="text-xs text-muted line-clamp-3" style={anim("aip-in", 380, 500)}>
            {t("Alasan AI:")} {d.rationale}
          </p>
        )}
      </div>
    );

  if (step === 1) {
    const words = d.text.split(/\s+/);
    const gap = Math.min(120, 3400 / words.length);
    return (
      <p className="text-[13px] leading-relaxed text-fg whitespace-pre-line">
        {words.map((w, i) => (
          <span key={i} className={i === words.length - 1 ? "ai-caret" : undefined} style={anim("aip-word", 160, 150 + i * gap)}>
            {w}{" "}
          </span>
        ))}
      </p>
    );
  }

  if (step === 2)
    return (
      <ul className="space-y-1.5">
        {d.checks.map((c, i) => (
          <li key={c.key} className="flex items-start gap-1.5 text-xs font-medium text-fg" style={anim("aip-in", 320, 300 + i * 450)}>
            <span className={cn("mt-px w-4 h-4 shrink-0 rounded-full text-on-accent flex items-center justify-center", c.ok ? "bg-success" : "bg-danger")}>
              {c.ok ? <Check className="w-3 h-3" strokeWidth={3} aria-hidden /> : <X className="w-3 h-3" strokeWidth={3} aria-hidden />}
            </span>
            <span className="min-w-0">
              {t(c.label)}
              {c.detail && <span className="text-muted"> · {t(c.detail)}</span>}
            </span>
          </li>
        ))}
        {work.criticScore !== null && (
          <li className="text-xs font-semibold text-fg" style={anim("aip-in", 320, 300 + d.checks.length * 450)}>
            {t("Skor editor AI:")} {work.criticScore}
          </li>
        )}
      </ul>
    );

  const status =
    work.status === "MENUNGGU_TINJAU"
      ? { text: t("Menunggu persetujuan Anda di tab Tinjau"), cls: "text-warning bg-warning-soft" }
      : work.status === "TERBIT"
        ? { text: t("Sudah terbit {time}", { time: hhmm(focus.slot.slotAt) }), cls: "text-success bg-success-soft" }
        : { text: t("Terjadwal {time}", { time: hhmm(focus.slot.slotAt) }), cls: "text-success bg-success-soft" };
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-full max-w-md rounded-xl bg-surface border border-line p-2.5 shadow-pop" style={anim("aip-in", 450)}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-fg truncate">{handle}</span>
          <span className={cn("ml-auto text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0", status.cls)} style={anim("aip-in", 320, 400)}>
            {status.text}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-fg line-clamp-3 whitespace-pre-line">{d.text}</p>
      </div>
    </div>
  );
}

/**
 * Kerja AI autopilot yang sebenarnya, bukan contoh:
 * - "Sedang bekerja": ada slot berstatus MENULIS. Halaman memperbarui data lebih sering selama itu.
 * - "Hasil terakhir": memutar ulang SEKALI ide, draf, pemeriksaan, dan status slot yang terakhir ditulis AI,
 *   diambil dari slot itu sendiri (satu permintaan per slot+status).
 * - Tidak ada pekerjaan: menunjukkan kapan AI mulai menulis slot berikutnya.
 * Murni CSS transform/opacity; berhenti saat di luar layar / tab tersembunyi; statis bila gerak dikurangi.
 */
export const AiPipeline = memo(function AiPipeline({
  slots,
  today,
  paused,
  handles,
}: {
  slots: AutopilotSlotDTO[];
  today: string;
  paused: boolean;
  /** accountId -> @username */
  handles: Map<string, string>;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [lastLive, setLastLive] = useState<string | null>(null);
  const focus = useMemo(() => pickFocus(slots, today, lastLive), [slots, today, lastLive]);
  const [work, setWork] = useState<SlotWorkDTO | null>(null);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [onScreen, setOnScreen] = useState(true);
  const [reduced, setReduced] = useState(false);

  // Ingat slot yang sedang ditulis (disesuaikan saat render): begitu selesai, hasil slot itulah yang diputar.
  const liveId = focus.mode === "live" ? focus.slot.id : null;
  if (liveId && liveId !== lastLive) setLastLive(liveId);

  const resultKey = focus.mode === "result" ? `${focus.slot.id}|${focus.slot.status}` : null;
  useEffect(() => {
    if (!resultKey) return;
    const ctrl = new AbortController();
    fetchSlotWork(resultKey.split("|")[0], ctrl.signal)
      .then((res) => {
        setWork(res.item);
        setStep(0);
        setRun((r) => r + 1);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [resultKey]);

  useEffect(() => {
    const el = rootRef.current;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = true;
    const sync = () => setOnScreen(inView && document.visibilityState === "visible");
    const onMq = () => setReduced(mq.matches);
    onMq();
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      sync();
    });
    if (el) io.observe(el);
    document.addEventListener("visibilitychange", sync);
    mq.addEventListener("change", onMq);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const shownWork = focus.mode === "result" && work?.id === focus.slot.id ? work : null;
  // Putar ulang berhenti di langkah terakhir; tidak berulang tanpa henti.
  const playing = focus.mode === "result" && !!shownWork && step < 3 && onScreen && !reduced;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setStep((s) => s + 1), stepMs(step, shownWork));
    return () => clearTimeout(timer);
  }, [playing, step, run, shownWork]);

  const viewStep = focus.mode === "live" ? 1 : focus.mode === "idle" ? -1 : reduced ? 3 : step;
  const handle = focus.slot ? (handles.get(focus.slot.accountId) ?? t("akun")) : t("akun");
  const caption =
    focus.mode === "live"
      ? t("AI sedang menulis draf sekarang. Setelah itu gerbang mutu memeriksanya sebelum masuk antrean.")
      : focus.mode === "result"
        ? t("Rekaman kerja AI untuk slot {time} {handle}. Klik langkah untuk melihat detailnya.", { time: hhmm(focus.slot.slotAt), handle })
        : t("Menunggu giliran slot berikutnya.");

  return (
    <section ref={rootRef} data-tour="ai-pipeline" aria-label={t("Kerja AI autopilot")} className={cn("card p-3 sm:p-4", !onScreen && "aip-off", reduced && "aip-static")}>
      <style href="ai-pipeline" precedence="default">{CSS}</style>
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent shrink-0" aria-hidden />
        <h3 className="text-sm font-bold text-fg truncate">{t("Kerja AI autopilot")}</h3>
        {focus.mode === "live" ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent bg-accent-soft rounded-full px-2 py-0.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" style={anim("aip-dot", 1200, 0, "infinite")} aria-hidden />
            {t("Sedang bekerja")}
          </span>
        ) : focus.mode === "result" ? (
          <span className="text-[11px] font-semibold text-muted bg-subtle rounded-full px-2 py-0.5 shrink-0">{t("Hasil terakhir")}</span>
        ) : null}
        {paused && <span className="text-[11px] font-semibold text-danger bg-danger-soft rounded-full px-2 py-0.5 shrink-0">{t("Dijeda")}</span>}
        {focus.mode === "result" && shownWork && (
          <button
            type="button"
            onClick={() => {
              setStep(0);
              setRun((r) => r + 1);
            }}
            aria-label={t("Putar ulang kerja AI")}
            className="ml-auto w-8 h-8 rounded-full text-muted hover:text-fg hover:bg-subtle inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      <ol className="mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = i === viewStep;
          const done = i < viewStep;
          return (
            <li key={s.label} className="min-w-0">
              <button
                type="button"
                disabled={focus.mode !== "result" || !shownWork}
                onClick={() => {
                  setStep(i);
                  setRun((r) => r + 1);
                }}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "w-full min-w-0 flex flex-col items-center gap-1 rounded-xl p-1.5 sm:p-2 transition-colors enabled:cursor-pointer",
                  active ? "bg-accent-soft" : "enabled:hover:bg-subtle"
                )}
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                    active ? "bg-accent text-on-accent" : done ? "bg-success-soft text-success" : "bg-subtle text-muted"
                  )}
                  style={active && focus.mode === "live" ? anim("aip-dot", 1400, 0, "infinite") : undefined}
                >
                  {done ? <Check className="w-4 h-4" strokeWidth={3} /> : <Icon className="w-4 h-4" />}
                </span>
                <span className={cn("text-[11px] sm:text-xs font-semibold leading-tight text-center", active ? "text-accent" : "text-muted")}>
                  {t(s.label)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-2 min-h-32 max-h-44 rounded-xl bg-subtle p-3 overflow-hidden">
        <Stage key={`${focus.mode}-${viewStep}-${run}`} step={viewStep} focus={focus} work={shownWork} handle={handle} />
      </div>
      <p className="mt-2 text-xs text-muted leading-relaxed" aria-live="polite">
        {caption}
      </p>
    </section>
  );
});
