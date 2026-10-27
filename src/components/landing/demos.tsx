"use client";

import React, { useMemo, useState } from "react";
import { Ban, CalendarHeart, Check, Clock, PenLine, Search, ShieldCheck, TrendingUp, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PERSONAS, jitter, pad, pickHours } from "./personas";

/**
 * Peraga interaktif halaman perkenalan. Semua isinya contoh yang ditulis tangan (bukan data pelanggan),
 * tetapi aturannya sama dengan yang dijalankan autopilot: jam ramai berjarak minimal 2,5 jam, draf
 * diperiksa sebelum antre, dan ide selalu punya sumber.
 */

function PersonaTabs({ value, onChange, label }: { value: string; onChange: (key: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full overflow-x-auto p-1 rounded-xl bg-subtle">
      {PERSONAS.map((p) => (
        <button
          key={p.key}
          type="button"
          role="tab"
          aria-selected={value === p.key}
          onClick={() => onChange(p.key)}
          className={cn(
            "h-9 px-3.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer whitespace-nowrap",
            value === p.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ peraga: atur jadwal */

export function HoursPlanner() {
  const [key, setKey] = useState(PERSONAS[0].key);
  const [count, setCount] = useState(3);
  const persona = PERSONAS.find((p) => p.key === key) ?? PERSONAS[0];
  const chosen = useMemo(() => pickHours(persona.hours, count), [persona, count]);
  const max = Math.max(...persona.hours);

  return (
    <div className="rounded-3xl border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PersonaTabs value={key} onChange={setKey} label="Contoh brand untuk jam ramai" />
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-muted">Posting per hari</span>
          <div role="radiogroup" aria-label="Posting per hari" className="inline-flex p-1 rounded-xl bg-subtle">
            {[3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => setCount(n)}
                className={cn(
                  "w-9 h-9 rounded-lg text-sm font-bold tabular-nums transition-colors cursor-pointer",
                  count === n ? "bg-accent text-on-accent" : "text-muted hover:text-fg"
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-end gap-[3px] sm:gap-1.5 h-40" aria-hidden="true">
        {persona.hours.map((v, h) => {
          const on = chosen.includes(h);
          return (
            <div key={h} className="group flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5">
              <div
                className={cn(
                  "w-full rounded-t-md transition-all duration-500 ease-out",
                  on ? "bg-accent" : "bg-line-strong/70 group-hover:bg-accent/45"
                )}
                style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
              />
              <span className={cn("lp-mono text-[10px] tabular-nums", on ? "font-bold text-accent" : "text-faint", h % 3 !== 0 && !on && "invisible sm:visible")}>{pad(h)}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-sm text-fg" aria-live="polite">
        <Clock className="inline w-4 h-4 mr-1.5 -mt-0.5 text-accent" />
        Tayang pukul{" "}
        {chosen.map((h, i) => (
          <React.Fragment key={h}>
            {i > 0 && (i === chosen.length - 1 ? " dan " : ", ")}
            <span className="lp-mono font-bold tabular-nums">
              {pad(h)}.{pad(jitter(h, count))}
            </span>
          </React.Fragment>
        ))}{" "}
        WIB.
      </p>
      <p className="mt-1.5 text-[13px] text-muted leading-relaxed">
        Dipilih dari jam dengan views tertinggi, dijaga berjarak 2,5 jam (bisa diatur), dan menitnya digeser sedikit tiap hari supaya tidak
        terasa seperti mesin.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ peraga: pemeriksaan draf */

interface Draft {
  label: string;
  text: string;
  checks: { name: string; ok: boolean; note: string }[];
  score: number | null;
}

const DRAFTS: Draft[] = [
  {
    label: "Draf A",
    text: "tim saus dipisah apa tim langsung disiram? jawab jujur, ini nentuin kita bisa temenan apa nggak",
    checks: [
      { name: "Bentuk", ok: true, note: "Panjang pas, kalimat utuh, ada ajakan menjawab." },
      { name: "Klaim", ok: true, note: "Tidak menyebut harga, promo, atau angka yang perlu dibuktikan." },
      { name: "Topik", ok: true, note: "Tidak menyentuh daftar topik terlarang." },
      { name: "Kembar", ok: true, note: "Tidak mirip dengan posting akun lain hari ini." },
    ],
    score: 0.87,
  },
  {
    label: "Draf B",
    text: "DISKON 50% semua menu cuma hari ini!! buruan sebelum kehabisan, mulai Rp9.000 aja 🔥",
    checks: [
      { name: "Bentuk", ok: true, note: "Panjang pas dan kalimat utuh." },
      { name: "Klaim", ok: false, note: "Diskon 50% dan Rp9.000 tidak ada di data promo brand ini. AI tidak boleh mengarang harga." },
      { name: "Topik", ok: true, note: "Tidak menyentuh daftar topik terlarang." },
      { name: "Kembar", ok: true, note: "Tidak mirip dengan posting akun lain hari ini." },
    ],
    score: null,
  },
  {
    label: "Draf C",
    text: "tim saus dipisah atau tim disiram langsung? jawab yang jujur ya, ini nentuin pertemanan kita",
    checks: [
      { name: "Bentuk", ok: true, note: "Panjang pas dan kalimat utuh." },
      { name: "Klaim", ok: true, note: "Tidak ada klaim yang perlu dibuktikan." },
      { name: "Topik", ok: true, note: "Tidak menyentuh daftar topik terlarang." },
      { name: "Kembar", ok: false, note: "Hampir sama dengan posting akun cabang lain pagi ini. Pembaca yang mengikuti keduanya akan melihat salinan." },
    ],
    score: null,
  },
];

export function GateDemo() {
  const [at, setAt] = useState(0);
  const draft = DRAFTS[at];
  const passed = draft.checks.every((c) => c.ok);

  return (
    <div className="rounded-3xl border border-line bg-surface overflow-hidden">
      <div role="tablist" aria-label="Contoh draf" className="flex border-b border-line">
        {DRAFTS.map((d, i) => (
          <button
            key={d.label}
            type="button"
            role="tab"
            aria-selected={at === i}
            onClick={() => setAt(i)}
            className={cn(
              "relative flex-1 h-12 text-sm font-semibold transition-colors cursor-pointer",
              at === i ? "text-accent" : "text-muted hover:text-fg"
            )}
          >
            {d.label}
            {at === i && <span className="absolute bottom-0 inset-x-4 h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
        <div>
          <p className="rounded-2xl bg-subtle p-4 text-[15px] leading-relaxed text-fg">{draft.text}</p>
          <div
            className={cn(
              "mt-3 flex items-start gap-2.5 rounded-xl p-3.5 text-sm font-semibold",
              passed ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
            )}
            role="status"
          >
            {passed ? <ShieldCheck className="w-[18px] h-[18px] mt-0.5 shrink-0" /> : <Ban className="w-[18px] h-[18px] mt-0.5 shrink-0" />}
            {passed
              ? `Lolos, nilai editor ${String(draft.score).replace(".", ",")}. Masuk antrean terbit.`
              : "Ditolak sebelum sampai ke antrean. AI menulis ulang dengan catatan ini."}
          </div>
        </div>

        <ul className="space-y-2.5">
          {draft.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                  c.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                )}
              >
                {c.ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
              </span>
              <p className="text-sm leading-relaxed">
                <span className="font-bold text-fg">{c.name}.</span> <span className="text-muted">{c.note}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ peraga: sumber ide */

const SOURCES = [
  {
    key: "jaringan",
    Icon: TrendingUp,
    label: "Posting terbaik Anda",
    signal: "Posting \"tim saus dipisah\" minggu lalu dapat views 4 kali lipat dari biasanya.",
    idea: "Seri \"tim ini atau tim itu\" dengan pilihan lain: pedas atau original, makan di tempat atau bungkus.",
  },
  {
    key: "tren",
    Icon: Search,
    label: "Tren pencarian",
    signal: "\"Bekal kantor hemat\" sedang ramai dicari di Indonesia hari ini.",
    idea: "Cerita singkat soal bekal yang niatnya hemat tapi jam 12 tetap pesan antar.",
  },
  {
    key: "momen",
    Icon: CalendarHeart,
    label: "Momen kalender",
    signal: "Tanggal 25 sampai 2: orang baru gajian.",
    idea: "Pertanyaan ringan: gajian pertama bulan ini dipakai traktir siapa?",
  },
  {
    key: "manual",
    Icon: Type,
    label: "Inspirasi Anda",
    signal: "Anda menempel catatan: \"pelanggan sering tanya kenapa antre panjang tiap Jumat\".",
    idea: "Jawaban jujur dari dapur soal Jumat, dengan ajakan cerita antrean terpanjang pembaca.",
  },
];

export function IdeaSources() {
  const [key, setKey] = useState(SOURCES[0].key);
  const source = SOURCES.find((s) => s.key === key) ?? SOURCES[0];

  return (
    <div className="grid md:grid-cols-[15rem_minmax(0,1fr)] gap-4">
      <div role="tablist" aria-label="Sumber ide" aria-orientation="vertical" className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SOURCES.map(({ key: k, Icon, label }) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={key === k}
            onClick={() => setKey(k)}
            className={cn(
              "shrink-0 flex items-center gap-2.5 h-12 px-4 rounded-xl border text-sm font-semibold text-left transition-colors cursor-pointer",
              key === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"
            )}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        ))}
      </div>

      <div className="rounded-3xl border border-line bg-surface p-5 sm:p-6" role="tabpanel">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Tren</p>
        <p className="mt-1.5 text-[15px] leading-relaxed text-fg">{source.signal}</p>
        <div className="my-4 flex items-center gap-3 text-xs font-semibold text-accent">
          <span className="h-px flex-1 bg-line" />
          <PenLine className="w-4 h-4" />
          menjadi ide
          <span className="h-px flex-1 bg-line" />
        </div>
        <p className="text-[15px] leading-relaxed font-semibold text-fg">{source.idea}</p>
        <p className="mt-4 text-[13px] text-muted leading-relaxed">
          Tiap ide diberi skor dari seberapa viral trennya, kebaruan, kecocokan dengan akun, dan kinerja pola serupa. Yang mirip posting lama
          dibuang.
        </p>
      </div>
    </div>
  );
}
