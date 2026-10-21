"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mascot, type MascotMood } from "./mascot";
import { TOUR_STEPS } from "./tour-steps";

/**
 * Tur pengenalan interaktif. Dimuat terpisah (lazy) hanya saat tur dibuka, jadi pengguna yang sudah selesai
 * tidak mengunduh kode ini. Spotlight = satu elemen dengan bayangan sebar besar yang bergeser (transisi CSS)
 * ke menu/elemen asli; posisi dihitung ulang hanya saat ukuran/scroll berubah (rAF), tanpa loop per frame.
 */

const PAD = 8;
const GAP = 16;
const CARD_W = 380;
const FIND_MS = 2500;
const POKES = [
  "Hehe, geli!",
  "Aku bangun kok, beneran.",
  "Klik Lanjut ya, masih banyak yang mau kutunjukkan.",
  "Aku jalan 24 jam, tapi kopi tetap boleh.",
  "Psst... jam ramai akunmu sudah kucatat.",
];

const STYLE = `
@keyframes btt-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes btt-word{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes btt-ring{0%{box-shadow:0 0 0 0 rgba(123,138,255,.55)}100%{box-shadow:0 0 0 14px rgba(123,138,255,0)}}
.btt-card{animation:btt-in .35s cubic-bezier(.22,1,.36,1) both}
.btt-word{display:inline-block;animation:btt-word .32s ease-out both}
.btt-ring{animation:btt-ring 1.6s ease-out infinite}
.btt-spot{transition:top .4s cubic-bezier(.22,1,.36,1),left .4s cubic-bezier(.22,1,.36,1),width .4s cubic-bezier(.22,1,.36,1),height .4s cubic-bezier(.22,1,.36,1),opacity .25s}
@media (prefers-reduced-motion:reduce){.btt-card,.btt-word,.btt-ring{animation:none!important}.btt-spot{transition:none!important}}
`;

type Box = { top: number; left: number; width: number; height: number };

function findAnchor(anchors: string[] | undefined): { el: HTMLElement; key: string } | null {
  for (const a of anchors ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS_ESCAPE(a)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { el, key: a };
    }
  }
  return null;
}

const MOBILE_W = 768;
/** Jarak kartu dari tepi bawah layar ponsel (di atas bilah navigasi bawah + area aman). */
const SHEET_BOTTOM = "calc(12px + env(safe-area-inset-bottom))";
const CSS_ESCAPE = (v: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(v) : v.replace(/"/g, '\\"'));

/** Kata demi kata muncul (CSS), diulang tiap ganti langkah lewat `key`. */
function Reveal({ text, delay = 0 }: { text: string; delay?: number }) {
  const words = text.split(" ");
  const gap = Math.min(28, 900 / words.length);
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="btt-word" style={{ animationDelay: `${delay + i * gap}ms` }}>
          {w}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export default function Tour({ onClose, hasAccounts }: { onClose: (finished: boolean) => void; hasAccounts: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [idx, setIdx] = useState(0);
  const [awake, setAwake] = useState(false);
  const [target, setTarget] = useState<Box | null>(null);
  const [card, setCard] = useState<{ w: number; h: number }>({ w: CARD_W, h: 260 });
  const [view, setView] = useState({ w: 1280, h: 800 });
  const [poke, setPoke] = useState<string | null>(null);
  /** Anchor yang ketemu (mis. "bnav:more" = menu ada di "Lainnya" pada ponsel). */
  const [matched, setMatched] = useState<string | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = TOUR_STEPS[idx];
  const last = idx === TOUR_STEPS.length - 1;

  const measure = useCallback(() => {
    setView({ w: window.innerWidth, h: window.innerHeight });
    const el = elRef.current;
    if (!el || !el.isConnected) {
      setTarget(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTarget({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, []);

  // Pindah halaman bila perlu, lalu cari elemen yang disorot (halaman baru butuh waktu untuk merender).
  useEffect(() => {
    if (!awake) return;
    const here = `${pathname}${search.size ? `?${search.toString()}` : ""}`;
    if (step.route && here !== step.route && pathname !== step.route.split("?")[0]) router.push(step.route, { scroll: false });
    if (!step.anchors?.length) return;
    let alive = true;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const seek = () => {
      if (!alive) return;
      const hit = findAnchor(step.anchors);
      if (hit) {
        const { el } = hit;
        elRef.current = el;
        setMatched(hit.key);
        const r = el.getBoundingClientRect();
        const fixed = hit.key.startsWith("nav:") || hit.key.startsWith("bnav:");
        if (!fixed) {
          if (window.innerWidth < MOBILE_W) {
            // Ponsel: kartu menempel di bawah, jadi target digulir ke bagian ATAS layar (bukan tengah).
            const top = 72;
            if (r.top < top || r.top > window.innerHeight * 0.3) window.scrollBy({ top: r.top - top, behavior: "smooth" });
          } else if (r.top < 72 || r.bottom > window.innerHeight - 96) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
        measure();
        return;
      }
      if (Date.now() - started < FIND_MS) timer = setTimeout(seek, 120);
    };
    seek();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat langkah berganti
  }, [idx, awake]);

  // Ukur ulang saat layar diubah ukurannya atau digulir (dibatasi satu kali per frame).
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    on();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    const ro = new ResizeObserver(on);
    if (elRef.current) ro.observe(elRef.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      ro.disconnect();
    };
  }, [measure, target === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ukuran kartu (untuk penempatan) dibaca lewat ResizeObserver, bukan tiap render.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.target.getBoundingClientRect();
      setCard((c) => (Math.abs(c.w - width) > 1 || Math.abs(c.h - height) > 1 ? { w: width, h: height } : c));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [awake, idx]);

  useEffect(() => {
    if (awake) nextRef.current?.focus({ preventScroll: true });
  }, [idx, awake]);

  const go = useCallback(
    (to: number) => {
      setPoke(null);
      if (to < 0) return;
      if (to >= TOUR_STEPS.length) onClose(true);
      else {
        // Lepas sorotan lama dulu; langkah baru mencari elemennya sendiri.
        elRef.current = null;
        setTarget(null);
        setMatched(null);
        setIdx(to);
      }
    },
    [onClose]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(false);
      } else if (!awake && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setAwake(true);
      } else if (awake && e.key === "ArrowRight") go(idx + 1);
      else if (awake && e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [awake, idx, go, onClose]);

  // Penempatan kartu: kanan target bila muat (menu samping), lalu bawah/atas; di HP selalu di bawah layar.
  const mobile = view.w < MOBILE_W;
  let pos: React.CSSProperties;
  let side: "left" | "right" | "none" = "none";
  if (!awake || !target) {
    pos = mobile ? { left: 8, right: 8, bottom: SHEET_BOTTOM } : { left: (view.w - card.w) / 2, top: Math.max(24, (view.h - card.h) / 2) };
  } else if (mobile) {
    // Target di bagian bawah (bilah navigasi): kartu tepat di atasnya. Selain itu kartu menempel di bawah layar.
    const targetLow = target.top > view.h * 0.6;
    pos = targetLow ? { left: 8, right: 8, bottom: Math.max(8, view.h - target.top + GAP) } : { left: 8, right: 8, bottom: SHEET_BOTTOM };
  } else {
    const clampY = (y: number) => Math.min(Math.max(16, y), view.h - card.h - 16);
    const clampX = (x: number) => Math.min(Math.max(16, x), view.w - card.w - 16);
    if (target.left + target.width + GAP + card.w < view.w - 16) {
      pos = { left: target.left + target.width + GAP, top: clampY(target.top + target.height / 2 - card.h / 2) };
      side = "left";
    } else if (target.left - GAP - card.w > 16) {
      pos = { left: target.left - GAP - card.w, top: clampY(target.top + target.height / 2 - card.h / 2) };
      side = "right";
    } else if (target.top + target.height + GAP + card.h < view.h - 16) {
      pos = { left: clampX(target.left), top: target.top + target.height + GAP };
    } else {
      pos = { left: clampX(target.left), top: Math.max(16, target.top - GAP - card.h) };
    }
  }

  // Sorotan dipotong ke area yang terlihat (elemen besar seperti tabel tidak menutupi kartu). Di ponsel area
  // terlihat = di atas kartu bila kartu menempel di bawah.
  let spot: Box | null = awake ? target : null;
  if (spot) {
    const sheetTop = mobile && !(target && target.top > view.h * 0.6) ? view.h - card.h - 12 - GAP : view.h - 8;
    const top = Math.max(8, spot.top);
    const bottom = Math.min(spot.top + spot.height, sheetTop);
    const left = Math.max(4, spot.left);
    const right = Math.min(view.w - 4, spot.left + spot.width);
    spot = bottom - top >= 32 && right - left >= 32 ? { top, left, width: right - left, height: bottom - top } : null;
  }
  const inMore = mobile && matched === "bnav:more";

  const mood: MascotMood = !awake ? "sleep" : poke ? "poke" : step.mood === "point" && !target ? "talk" : step.mood;

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Tur pengenalan BotThreads">
      <style href="bt-tour" precedence="default">
        {STYLE}
      </style>
      {/* Lapisan penangkap klik: halaman di belakang tidak bisa diklik selama tur. */}
      <div className="absolute inset-0" />
      {/* Spotlight: lubang terang di atas elemen asli; tanpa target, seluruh layar diredupkan. */}
      <div
        className="btt-spot absolute rounded-2xl pointer-events-none"
        style={
          spot
            ? { top: spot.top, left: spot.left, width: spot.width, height: spot.height, boxShadow: "0 0 0 9999px rgba(6,8,18,.72)" }
            : { top: view.h / 2, left: view.w / 2, width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(6,8,18,.78)" }
        }
      >
        {spot && <div className="btt-ring absolute inset-0 rounded-2xl border-2 border-accent" />}
      </div>

      <div
        ref={cardRef}
        key={awake ? step.id : "tidur"}
        className="btt-card absolute flex flex-col rounded-3xl border border-line bg-surface shadow-pop p-4 sm:p-5"
        style={{
          ...pos,
          width: mobile ? undefined : CARD_W,
          maxWidth: mobile ? undefined : "calc(100vw - 32px)",
          // Kartu tidak pernah lebih tinggi dari layar; isi panjang digulir di dalam kartu.
          maxHeight: mobile ? "min(68dvh, calc(100dvh - 96px))" : "calc(100dvh - 32px)",
        }}
      >
        <button
          type="button"
          onClick={() => onClose(false)}
          aria-label="Tutup tur"
          className="absolute top-3 right-3 w-8 h-8 rounded-full text-muted hover:text-fg hover:bg-subtle inline-flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {!awake ? (
          <div className="flex flex-col items-center text-center pt-2">
            <Mascot mood="sleep" size={mobile ? 104 : 132} onClick={() => setAwake(true)} label="Bangunkan maskot" className="hover:scale-[1.03] transition-transform" />
            <p className="mt-2 text-base font-bold text-fg">Ssst... robotnya lagi tidur</p>
            <p className="mt-1 text-sm text-muted max-w-xs">Wajar, dia kerja semalaman memposting untuk akunmu. Klik robotnya untuk membangunkan dan mulai tur singkat.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => onClose(false)}
                className="h-10 px-4 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-subtle cursor-pointer"
              >
                Nanti saja
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setAwake(true)}
                className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hover cursor-pointer"
              >
                Bangunkan
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2.5 sm:gap-3 pr-6 shrink-0">
              <Mascot
                mood={mood}
                size={mobile ? 52 : 76}
                flip={side === "left"}
                onClick={() => setPoke(POKES[Math.floor(Math.random() * POKES.length)])}
                label="Colek maskot"
                key={`${step.id}-${poke ?? ""}`}
              />
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-accent">
                  {idx === 0 ? "Tur singkat" : `Langkah ${idx} dari ${TOUR_STEPS.length - 2}`}
                </p>
                <h2 className="mt-0.5 text-[15px] sm:text-[17px] font-bold text-fg leading-snug">{step.title}</h2>
              </div>
            </div>

            {/* Bagian isi bisa digulir sendiri bila layar pendek; judul dan tombol tetap terlihat. */}
            <div className="mt-2.5 sm:mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="rounded-2xl bg-subtle px-3 py-2.5 sm:px-3.5 sm:py-3 text-[13.5px] sm:text-sm text-fg leading-relaxed" aria-live="polite">
              {poke ? <span className="font-semibold">{poke}</span> : <Reveal text={step.body} />}
            </div>
            {inMore && !poke && (
              <p className="mt-2 text-xs font-medium text-accent">Di HP, menu ini ada di tombol Lainnya pada bilah bawah.</p>
            )}
            {!poke && step.points && (
              <ul className="mt-2.5 space-y-1.5">
                {step.points.map((p, i) => (
                  <li key={p} className="btt-word flex items-start gap-2 text-xs sm:text-[13px] text-muted" style={{ animationDelay: `${500 + i * 120}ms` }}>
                    <Check className="w-3.5 h-3.5 mt-0.5 text-success shrink-0" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            </div>

            {/* Progres: titik per langkah, bisa diklik untuk melompat. */}
            <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-1 shrink-0" role="tablist" aria-label="Langkah tur">
              {TOUR_STEPS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  aria-label={`${i + 1}. ${s.chip}`}
                  title={s.chip}
                  onClick={() => go(i)}
                  className={cn(
                    "h-1.5 rounded-full transition-all cursor-pointer",
                    i === idx ? "w-6 bg-accent" : i < idx ? "w-2.5 bg-accent/50" : "w-2.5 bg-line-strong hover:bg-muted"
                  )}
                />
              ))}
            </div>

            <div className="mt-3 sm:mt-4 flex items-center gap-2 shrink-0">
              {!last && (
                <button
                  type="button"
                  onClick={() => onClose(false)}
                  className="h-10 px-3 rounded-full text-sm font-semibold text-muted hover:text-fg hover:bg-subtle cursor-pointer"
                >
                  Lewati
                </button>
              )}
              <div className="ml-auto flex items-center gap-2">
                {idx > 0 && (
                  <button
                    type="button"
                    onClick={() => go(idx - 1)}
                    aria-label="Langkah sebelumnya"
                    className="w-10 h-10 rounded-full border border-line-strong text-fg hover:border-accent hover:text-accent inline-flex items-center justify-center cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                {last ? (
                  <button
                    ref={nextRef}
                    type="button"
                    onClick={() => {
                      onClose(true);
                      router.push(hasAccounts ? "/autopilot" : "/akun");
                    }}
                    className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hover inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {hasAccounts ? "Buka Autopilot" : "Hubungkan akun"}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    ref={nextRef}
                    type="button"
                    onClick={() => go(idx + 1)}
                    className="h-10 px-5 rounded-full bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hover inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {idx === 0 ? "Mulai" : "Lanjut"}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {!mobile && <p className="mt-2 text-[11px] text-faint text-right">Tombol panah ← → untuk pindah, Esc untuk keluar</p>}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
