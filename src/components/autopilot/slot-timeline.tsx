"use client";

import React, { memo, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SLOT_KIND_LABEL, SLOT_STATUS_LABEL, type AutopilotSlotDTO, type SlotStatus } from "@/lib/autopilot-types";
import { wibParts } from "@/lib/scheduling";
import { SLOT_STATUS_STYLE, isStruck, pad2 } from "./shared";

/** Rentang garis waktu (jam WIB). */
const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const SPAN = LAST_HOUR - FIRST_HOUR;
const SCALE_HOURS = [6, 12, 18, 23];
const GRID_HOURS = [9, 12, 15, 18, 21];

const percentOf = (hour: number, minute: number): number =>
  Math.min(100, Math.max(0, ((hour + minute / 60 - FIRST_HOUR) / SPAN) * 100));

/** Label jam di bawah/atas garis (06, 12, 18, 23). */
export function TimelineScale({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-3.5 mx-1.5 text-[10px] font-medium text-faint tabular-nums", className)} aria-hidden>
      {SCALE_HOURS.map((h, i) => (
        <span
          key={h}
          className={cn(
            "absolute top-0",
            i === 0 ? "left-0" : i === SCALE_HOURS.length - 1 ? "right-0" : "-translate-x-1/2"
          )}
          style={i === 0 || i === SCALE_HOURS.length - 1 ? undefined : { left: `${percentOf(h, 0)}%` }}
        >
          {pad2(h)}
        </span>
      ))}
    </div>
  );
}

const LEGEND: SlotStatus[] = ["DIRENCANAKAN", "MENULIS", "MENUNGGU_TINJAU", "TERANTRE", "TERBIT", "GAGAL", "DILEWATI"];

function Dot({ status, className }: { status: SlotStatus; className?: string }) {
  return (
    <span className={cn("relative block w-3 h-3 rounded-full", SLOT_STATUS_STYLE[status].dot, className)}>
      {isStruck(status) && <span className="absolute left-1/2 top-1/2 w-3.5 h-0.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-muted" />}
    </span>
  );
}

/** Keterangan warna titik (warna tidak pernah jadi satu-satunya penanda: tiap titik punya tooltip). */
export function TimelineLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted", className)} aria-label="Keterangan status slot">
      {LEGEND.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <Dot status={s} className={s === "MENULIS" ? "animate-none" : undefined} />
          {s === "DILEWATI" ? "Dilewati / dibatalkan" : SLOT_STATUS_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

interface SlotTimelineProps {
  slots: AutopilotSlotDTO[];
  /** "Hari ini" atau "Besok" untuk label aksesibilitas. */
  dayLabel: string;
  /** Epoch ms "sekarang" (dari state); garis penanda hanya untuk hari ini. */
  nowMs?: number | null;
  /** Autopilot akun mati: garis diredupkan. */
  dimmed?: boolean;
}

/**
 * Garis waktu 06.00-23.00 WIB dengan satu titik per slot. Rincian tiap titik muncul saat diarahkan,
 * difokus, atau diketuk (ketuk lagi / Esc / ketuk di luar untuk menutup).
 */
export const SlotTimeline = memo(function SlotTimeline({ slots, dayLabel, nowMs, dimmed }: SlotTimelineProps) {
  const [active, setActive] = useState<{ id: string; pinned: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  // Tooltip yang disematkan tidak boleh tersisa saat tab atau halaman disembunyikan lalu ditampilkan lagi.
  useLayoutEffect(() => () => setActive(null), []);

  const pinnedId = active?.pinned ? active.id : null;
  useEffect(() => {
    if (!pinnedId) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setActive(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinnedId]);

  const now = nowMs ? wibParts(new Date(nowMs)) : null;
  const nowPct = now && now.h >= FIRST_HOUR && now.h < LAST_HOUR ? percentOf(now.h, now.min) : null;

  const shown = active ? slots.find((s) => s.id === active.id) : undefined;
  const shownParts = shown ? wibParts(new Date(shown.slotAt)) : null;
  const shownPct = shownParts ? percentOf(shownParts.h, shownParts.min) : 0;
  const detail = shown ? [shown.skipReason, shown.lastError].filter((v, i, list): v is string => !!v && list.indexOf(v) === i) : [];

  return (
    <div ref={rootRef} className={cn("relative h-10 mx-1.5", dimmed && slots.length === 0 && "opacity-50")}>
      {/* Rel + garis bantu tiap 3 jam */}
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-subtle" aria-hidden />
      {GRID_HOURS.map((h) => (
        <span
          key={h}
          aria-hidden
          className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-line-strong"
          style={{ left: `${percentOf(h, 0)}%` }}
        />
      ))}
      {nowPct !== null && (
        <span
          aria-hidden
          title="Sekarang"
          className="absolute top-1/2 h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/45"
          style={{ left: `${nowPct}%` }}
        />
      )}

      {slots.length === 0 && <span className="sr-only">Tidak ada slot {dayLabel.toLowerCase()}.</span>}

      {slots.map((s) => {
        const p = wibParts(new Date(s.slotAt));
        const open = active?.id === s.id;
        return (
          <button
            key={s.id}
            type="button"
            aria-label={`Slot ${dayLabel.toLowerCase()} ${pad2(p.h)}.${pad2(p.min)} WIB, ${SLOT_STATUS_LABEL[s.status]}`}
            aria-describedby={open ? tipId : undefined}
            onMouseEnter={() => setActive((cur) => (cur?.pinned ? cur : { id: s.id, pinned: false }))}
            onMouseLeave={() => setActive((cur) => (cur && !cur.pinned && cur.id === s.id ? null : cur))}
            onFocus={() => setActive((cur) => (cur?.id === s.id ? cur : { id: s.id, pinned: false }))}
            onBlur={() => setActive((cur) => (cur?.id === s.id ? null : cur))}
            onClick={() => setActive((cur) => (cur?.id === s.id && cur.pinned ? null : { id: s.id, pinned: true }))}
            className="group absolute top-0 h-10 w-7 -translate-x-1/2 inline-flex items-center justify-center rounded-lg cursor-pointer"
            style={{ left: `${percentOf(p.h, p.min)}%` }}
          >
            <Dot
              status={s.status}
              className={cn("transition-transform group-hover:scale-125", open && "scale-125 ring-2 ring-accent/30")}
            />
          </button>
        );
      })}

      {shown && shownParts && (
        <div
          id={tipId}
          role="tooltip"
          className={cn(
            "absolute z-20 bottom-full mb-0.5 w-56 max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-surface p-3 text-left text-xs shadow-pop animate-[pop-in_150ms_ease-out]",
            shownPct < 30 ? "left-0" : shownPct > 70 ? "right-0" : "-translate-x-1/2"
          )}
          style={shownPct >= 30 && shownPct <= 70 ? { left: `${shownPct}%` } : undefined}
        >
          <p className="font-semibold text-fg">
            {pad2(shownParts.h)}.{pad2(shownParts.min)} WIB · {SLOT_STATUS_LABEL[shown.status]}
          </p>
          <p className="mt-0.5 font-medium text-muted">{SLOT_KIND_LABEL[shown.kind]}</p>
          {detail.length > 0 ? (
            detail.map((text) => (
              <p key={text} className={cn("mt-1.5 break-words", text === shown.lastError ? "text-danger" : "text-muted")}>
                {text}
              </p>
            ))
          ) : shown.reason ? (
            <p className="mt-1.5 break-words text-muted">{shown.reason}</p>
          ) : null}
        </div>
      )}
    </div>
  );
});
