"use client";

import React, { useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { heroStore, useHero } from "./hero-store";

const EXAMPLES = ["skincare", "kopi susu", "bengkel motor", "laundry kiloan", "hijab", "seblak"];
const QUICK = ["skincare", "bengkel motor", "kopi", "laundry"];

/**
 * Kolom "coba untuk bisnis Anda": pengunjung mengetik jenis bisnisnya, papan jadwal di sebelahnya
 * langsung menyusun hari autopilot untuk bisnis itu. Semuanya di browser (contoh tertulis, tanpa
 * panggilan AI/jaringan), jadi responsnya instan.
 */
export function HeroTry() {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState(0);
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Contoh di placeholder berganti pelan, hanya selama kolom kosong, tidak difokus, dan terlihat.
  useEffect(() => {
    if (value || focused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = formRef.current;
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !id) id = window.setInterval(() => setHint((h) => (h + 1) % EXAMPLES.length), 2400);
      if (!e.isIntersecting && id) {
        clearInterval(id);
        id = 0;
      }
    });
    if (el) io.observe(el);
    return () => {
      io.disconnect();
      clearInterval(id);
    };
  }, [value, focused]);

  const run = (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    heroStore.set({ key: "custom", custom: clean });
    // Di layar sempit papan ada di bawah: bawa ke sana supaya hasilnya langsung terlihat.
    const board = document.getElementById("hero-board");
    if (board && board.getBoundingClientRect().top > window.innerHeight * 0.55) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      board.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        run(value || EXAMPLES[hint]);
      }}
      className="w-full max-w-xl"
    >
      <label htmlFor="hero-try" className="lp-mono flex items-center gap-2 text-[11px] font-bold tracking-widest text-muted">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        COBA UNTUK BISNIS ANDA
      </label>
      <div className="lp-try mt-2.5 flex items-center gap-2 p-1.5 pl-4 rounded-2xl border border-line bg-surface transition-colors focus-within:border-accent">
        <input
          id="hero-try"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={24}
          autoComplete="off"
          enterKeyHint="go"
          placeholder={`mis. ${EXAMPLES[hint]}`}
          className="min-w-0 flex-1 h-11 bg-transparent text-[15px] text-fg placeholder:text-faint outline-none"
        />
        <button
          type="submit"
          className="lp-cta shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-fg text-canvas text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          <span className="hidden sm:inline">Susun jadwal</span>
          <span className="sm:hidden">Susun</span>
          <ArrowRight className="lp-arrow w-4 h-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              setValue(q);
              run(q);
            }}
            className="h-8 px-3 rounded-full border border-line bg-surface text-xs font-semibold text-muted hover:text-fg hover:border-accent transition-colors cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>
    </form>
  );
}

const STATUS: Record<string, { dot: string; text: (time: string, n: number) => string }> = {
  Direncanakan: { dot: "bg-faint", text: (_, n) => `menghitung ${n} jam tayang terbaik` },
  Menulis: { dot: "bg-accent lp-live", text: (t) => `AI menulis draf ${t}` },
  Diperiksa: { dot: "bg-warning lp-live", text: (t) => `memeriksa draf ${t} · skor 0,87` },
  Terantre: { dot: "bg-success", text: (t) => `draf ${t} lolos · antre` },
  Selesai: { dot: "bg-success", text: (_, n) => `${n} posting siap terbit hari ini` },
};

/** Cap status di atas papan: ikut tahap yang sedang dikerjakan papan (menulis, memeriksa, selesai). */
export function HeroStatus({ className }: { className?: string }) {
  const phase = useHero((s) => s.phase);
  const time = useHero((s) => s.time);
  const slots = useHero((s) => s.slots);
  const s = STATUS[phase] ?? STATUS.Direncanakan;
  const text = s.text(time, slots);
  return (
    <p aria-live="polite" className={cn("lp-mono items-center gap-2 h-9 px-3 rounded-lg bg-fg text-canvas text-[11px] font-bold shadow-pop", className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
      <span key={text} className="lp-swap whitespace-nowrap">
        {text}
      </span>
    </p>
  );
}
