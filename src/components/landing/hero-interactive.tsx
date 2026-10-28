"use client";

import React, { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n/lang-provider";
import { isDeskCodeReady, preloadDeskPlayer } from "./hero-film/desk-section";
import { DESC, DESC_CLASS, H1_CLASS, HEADLINE_LINES, SUB, SUB_CLASS } from "./hero-copy-data";
import { heroStore, useHero } from "./hero-store";

/** Judul pembuka, diketik per huruf (CSS .lp-type). Jumlah huruf dihitung dari teks yang tampil (ID atau EN). */
const TYPE_MS = 45;

/** Judul pembuka: teks utuh tetap di HTML (SEO, pembaca layar); CSS membukanya per huruf. */
export function HeroHeadline() {
  const t = useT();
  const lines: { key: string; text: string; className: string; start: number; n: number }[] = [];
  let start = 250;
  for (const [i, l] of HEADLINE_LINES.entries()) {
    const text = t(l.text);
    const n = Array.from(text).length;
    lines.push({ key: l.text, text, n, start, className: `${l.className}${i === HEADLINE_LINES.length - 1 ? " lp-type-last" : ""}` });
    start += n * TYPE_MS + 120;
  }
  return (
    <h1 className={H1_CLASS}>
      {lines.map((l) => (
        <span
          key={l.key}
          className={`lp-type block w-fit ${l.className}`}
          style={{ "--n": l.n, "--start": `${l.start}ms`, "--dur": `${l.n * TYPE_MS}ms` } as React.CSSProperties}
        >
          {l.text}
        </span>
      ))}
    </h1>
  );
}

/** Deskripsi pembuka; kata kunci tebal lalu menyala ke warna aksen bergiliran (.lp-key). */
export function HeroDesc() {
  const t = useT();
  let order = 0;
  return (
    <p className={`lp-rise ${DESC_CLASS}`} style={{ "--i": 3 } as React.CSSProperties}>
      {DESC.map((seg, i) =>
        seg.key ? (
          <strong key={i} className="lp-key" style={{ "--d": order++ } as React.CSSProperties}>
            {t(seg.text)}
          </strong>
        ) : (
          <Fragment key={i}>{t(seg.text)}</Fragment>
        )
      )}
    </p>
  );
}

export function HeroSub() {
  const t = useT();
  return (
    <p className={`lp-rise ${SUB_CLASS}`} style={{ "--i": 4 } as React.CSSProperties}>
      {t(SUB.lead)}
      <span className="lp-gradient-text">{t(SUB.accent)}</span>
    </p>
  );
}

const EXAMPLES = ["skincare", "kopi susu", "bengkel motor", "laundry kiloan", "hijab", "seblak"];
const QUICK = ["skincare", "bengkel motor", "kopi", "laundry"];

/**
 * Kolom "coba untuk bisnis Anda": pengunjung mengetik jenis bisnisnya, papan jadwal di sebelahnya
 * langsung menyusun hari autopilot untuk bisnis itu. Semuanya di browser (contoh tertulis, tanpa
 * panggilan AI/jaringan), jadi responsnya instan.
 */
export function HeroTry() {
  const t = useT();
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
    preloadDeskPlayer();
    heroStore.set({ key: "custom", custom: clean });
    // Di layar sempit papan ada di bawah: bawa ke sana supaya hasilnya langsung terlihat.
    const board = document.getElementById("hero-board");
    if (board && board.getBoundingClientRect().top > window.innerHeight * 0.55) {
      // Gulir halus hanya bila kode animasinya sudah siap; kalau belum, lompat langsung supaya
      // menyiapkan Remotion tidak membuat guliran tersendat (sampulnya tampil sebentar).
      const smooth = isDeskCodeReady() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      board.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        run(value || t(EXAMPLES[hint]));
      }}
      className="w-full max-w-xl"
    >
      <label htmlFor="hero-try" className="lp-mono flex items-center gap-2 text-[11px] font-bold tracking-widest text-muted">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        {t("COBA UNTUK BISNIS ANDA")}
      </label>
      <div className="lp-try mt-2.5 flex items-center gap-2 p-1.5 pl-4 rounded-2xl border border-line bg-surface transition-colors focus-within:border-accent">
        <input
          id="hero-try"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            setFocused(true);
            // Siapkan animasi di sela ketikan (saat browser senggang), bukan tepat saat kolom diketuk.
            if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(preloadDeskPlayer, { timeout: 1200 });
            else setTimeout(preloadDeskPlayer, 300);
          }}
          onBlur={() => setFocused(false)}
          maxLength={24}
          autoComplete="off"
          enterKeyHint="go"
          placeholder={t("mis. {contoh}", { contoh: t(EXAMPLES[hint]) })}
          className="min-w-0 flex-1 h-11 bg-transparent text-[15px] text-fg placeholder:text-faint outline-none"
        />
        <button
          type="submit"
          className="lp-cta shrink-0 inline-flex items-center gap-1.5 h-11 px-4 rounded-xl bg-fg text-canvas text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
        >
          <span className="hidden sm:inline">{t("Susun jadwal")}</span>
          <span className="sm:hidden">{t("Susun")}</span>
          <ArrowRight className="lp-arrow w-4 h-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {QUICK.map((key) => {
          const q = t(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setValue(q);
                run(q);
              }}
              className="h-8 px-3 rounded-full border border-line bg-surface text-xs font-semibold text-muted hover:text-fg hover:border-accent transition-colors cursor-pointer"
            >
              {q}
            </button>
          );
        })}
      </div>
    </form>
  );
}

/** Kunci = tahap papan (hero-store); `text` = kunci terjemahan dengan {time} (jam tayang) dan {n} (jumlah slot). */
const STATUS: Record<string, { dot: string; text: string }> = {
  Direncanakan: { dot: "bg-faint", text: "menghitung {n} jam tayang terbaik" },
  Menulis: { dot: "bg-accent lp-live", text: "AI menulis draf {time}" },
  Diperiksa: { dot: "bg-warning lp-live", text: "memeriksa draf {time} · skor 0,87" },
  Terantre: { dot: "bg-success", text: "draf {time} lolos · antre" },
  Terbit: { dot: "bg-success lp-live", text: "terbit {time} · suka mulai masuk" },
  Selesai: { dot: "bg-success", text: "{n} posting siap terbit hari ini" },
};

/** Cap status di atas kartu animasi: ikut tahap yang sedang tampil di monitor (menulis, memeriksa, terbit). */
export function HeroStatus({ className }: { className?: string }) {
  const t = useT();
  const phase = useHero((s) => s.phase);
  const time = useHero((s) => s.time);
  const slots = useHero((s) => s.slots);
  const s = STATUS[phase] ?? STATUS.Direncanakan;
  const text = t(s.text, { time, n: slots });
  return (
    <p aria-live="polite" className={cn("lp-mono items-center gap-2 h-9 px-3 rounded-lg bg-fg text-canvas text-[11px] font-bold shadow-pop", className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
      <span key={text} className="lp-swap whitespace-nowrap">
        {text}
      </span>
    </p>
  );
}
