"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Ban, CalendarHeart, Check, Clock, PenLine, Search, ShieldCheck, TrendingUp, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThreadsActions, ThreadsMark } from "./threads-mark";

/**
 * Peraga interaktif halaman perkenalan. Semua isinya contoh yang ditulis tangan (bukan data pelanggan),
 * tetapi aturannya sama dengan yang dijalankan autopilot: jam ramai berjarak minimal 2,5 jam, draf
 * diperiksa sebelum antre, dan ide selalu punya sumber.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ contoh brand */

interface Persona {
  key: string;
  label: string;
  handle: string;
  /** Rata-rata views per jam 00-23 (bentuknya saja yang penting). */
  hours: number[];
  posts: { text: string; from: string }[];
}

const PERSONAS: Persona[] = [
  {
    key: "kuliner",
    label: "Kuliner",
    handle: "@kedai.sore",
    hours: [8, 4, 2, 1, 1, 3, 9, 16, 21, 18, 22, 41, 58, 37, 20, 19, 27, 44, 62, 71, 66, 48, 30, 15],
    posts: [
      { text: "Jam 11 itu jam paling jujur. Belum lapar banget, tapi sudah mulai buka aplikasi pesan antar tiap lima menit.", from: "Jam makan siang" },
      { text: "Tim saus dipisah atau tim langsung disiram? Jawab jujur, ini menentukan pertemanan.", from: "Posting terbaik minggu lalu" },
      { text: "Tanggal 25 dompet tersenyum lagi. Yang kemarin bilang hemat, malam ini traktir siapa?", from: "Momen gajian" },
    ],
  },
  {
    key: "kopi",
    label: "Kedai kopi",
    handle: "@seduh.pagi",
    hours: [5, 3, 1, 1, 2, 9, 31, 55, 64, 47, 29, 22, 26, 33, 41, 38, 30, 24, 28, 36, 39, 27, 16, 9],
    posts: [
      { text: "Senin itu bukan soal semangat. Senin itu soal siapa yang sampai kantor duluan dan kebagian kopi masih panas.", from: "Momen awal pekan" },
      { text: "Kopi susu gula aren sudah lima tahun dibilang tren sesaat. Masih di sini, masih dipesan, masih enak.", from: "Tren pencarian" },
      { text: "Jam 3 sore: mata berat, tugas numpuk, gelas kedua mulai terdengar masuk akal.", from: "Jam ramai akun ini" },
    ],
  },
  {
    key: "fashion",
    label: "Fashion",
    handle: "@lemari.kecil",
    hours: [12, 6, 3, 1, 1, 2, 6, 11, 14, 17, 21, 26, 34, 30, 24, 23, 29, 36, 43, 57, 74, 79, 58, 31],
    posts: [
      { text: "Baju yang paling sering dipakai bukan yang paling mahal. Yang paling sering dipakai itu yang tidak perlu disetrika.", from: "Posting terbaik minggu lalu" },
      { text: "Outfit kondangan bulan ini sudah tiga kali sama. Solusinya bukan beli baru, tapi ganti circle. Bercanda. Sedikit.", from: "Momen akhir pekan" },
      { text: "Malam minggu, keranjang belanja penuh, saldo bilang sabar. Siapa yang menang malam ini?", from: "Jam ramai akun ini" },
    ],
  },
];

function PersonaTabs({ value, onChange, label }: { value: string; onChange: (key: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex p-1 rounded-xl bg-subtle">
      {PERSONAS.map((p) => (
        <button
          key={p.key}
          type="button"
          role="tab"
          aria-selected={value === p.key}
          onClick={() => onChange(p.key)}
          className={cn(
            "h-9 px-3.5 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer",
            value === p.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ jam ramai */

/** Pilih `n` jam terbaik yang berjarak minimal 3 jam (aturan produk: jeda minimal 150 menit). */
function pickHours(hours: number[], n: number): number[] {
  const order = hours.map((v, h) => ({ v, h })).filter((x) => x.h >= 6).sort((a, b) => b.v - a.v);
  const out: number[] = [];
  for (const { h } of order) {
    if (out.length >= n) break;
    if (out.every((o) => Math.abs(o - h) >= 3)) out.push(h);
  }
  return out.sort((a, b) => a - b);
}
/** Menit tayang digeser sedikit supaya tidak tampak seperti mesin (di produk: 0-17 menit per akun per hari). */
const jitter = (h: number, seed: number): number => (h * 7 + seed * 5) % 18;

/* ------------------------------------------------------------------ peraga utama: satu hari autopilot */

const PHASES = ["Direncanakan", "Menulis", "Diperiksa", "Terantre"] as const;
const PHASE_CLS: Record<(typeof PHASES)[number], string> = {
  Direncanakan: "bg-subtle text-muted",
  Menulis: "bg-accent-soft text-accent",
  Diperiksa: "bg-warning-soft text-warning",
  Terantre: "bg-success-soft text-success",
};
const STEP_MS = 1700;

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((v) => (v >= text.length ? v : v + 3)), 28);
    return () => clearInterval(id);
  }, [text]);
  return (
    <>
      {text.slice(0, n)}
      {n < text.length && <span className="inline-block w-[2px] h-[1em] align-[-2px] bg-accent animate-pulse" />}
    </>
  );
}

export function HeroDemo() {
  const [key, setKey] = useState(PERSONAS[0].key);
  const [tick, setTick] = useState(0);
  const persona = PERSONAS.find((p) => p.key === key) ?? PERSONAS[0];
  const slots = useMemo(() => pickHours(persona.hours, 3), [persona]);
  const last = slots.length * 3;

  useEffect(() => {
    // Tanpa animasi bila pengguna memintanya: langsung tampilkan hasil akhirnya.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setTick(99), 0);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => setTick((t) => (t >= last + 3 ? 0 : t + 1)), STEP_MS);
    return () => clearInterval(id);
  }, [last, key]);

  const pick = (next: string) => {
    setKey(next);
    setTick(0);
  };

  return (
    <div className="rounded-3xl border border-line bg-surface shadow-pop overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-line">
        <div className="min-w-0">
          <p className="lp-mono flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-faint">
            <span className="lp-live w-1.5 h-1.5 rounded-full bg-success" />
            Hari ini di
          </p>
          <p className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <ThreadsMark className="w-4 h-4" />
            <span className="truncate">{persona.handle}</span>
          </p>
        </div>
        <PersonaTabs value={key} onChange={pick} label="Contoh brand" />
      </div>

      <ol className="divide-y divide-line">
        {slots.map((h, i) => {
          const local = Math.min(3, Math.max(0, tick - i * 3));
          const phase = PHASES[local];
          const post = persona.posts[i % persona.posts.length];
          return (
            <li
              key={`${key}-${h}`}
              className={cn(
                "relative px-4 sm:px-5 py-4 flex flex-col sm:flex-row gap-2.5 sm:gap-3.5 transition-colors duration-500",
                local === 1 || local === 2 ? "bg-accent-soft/40" : "bg-transparent"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-accent transition-opacity duration-500",
                  local === 1 || local === 2 ? "opacity-100" : "opacity-0"
                )}
              />
              <div className="flex items-baseline gap-1.5 sm:block sm:w-14 shrink-0">
                <p className="lp-mono text-base font-bold tabular-nums text-fg">
                  {pad(h)}.{pad(jitter(h, i))}
                </p>
                <p className="lp-mono text-[11px] text-faint">WIB</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold transition-colors", PHASE_CLS[phase])}>{phase}</span>
                  <span className="text-xs text-muted truncate">Ide dari: {post.from}</span>
                </div>
                {/* Begitu ditulis, drafnya tampil seperti posting Threads: avatar, nama akun, lalu deretan tindakan saat siap terbit. */}
                <div className="mt-2.5 flex gap-2.5 min-h-[7.5rem] sm:min-h-[6.25rem]">
                  <span
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold uppercase shrink-0 transition-colors duration-500",
                      local === 0 ? "bg-subtle text-faint" : "bg-fg text-canvas"
                    )}
                  >
                    {persona.handle[1]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-[13px] font-bold transition-colors", local === 0 ? "text-faint" : "text-fg")}>{persona.handle.slice(1)}</p>
                    {local === 0 ? (
                      <div className="mt-2 space-y-2" aria-label="Draf ditulis mendekati jam tayang">
                        <span className="block h-2.5 w-full rounded-full bg-subtle" />
                        <span className="block h-2.5 w-11/12 rounded-full bg-subtle" />
                        <span className="block h-2.5 w-3/5 rounded-full bg-subtle" />
                      </div>
                    ) : (
                      <p className="mt-0.5 text-sm leading-relaxed text-fg">{local === 1 ? <Typed key={`${key}-${i}`} text={post.text} /> : post.text}</p>
                    )}
                    <ThreadsActions className={cn("mt-2.5 transition-opacity duration-500", local === 3 ? "opacity-100" : "opacity-0")} />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="px-4 sm:px-5 py-3 border-t border-line bg-subtle/60 text-xs text-muted">
        Contoh ilustrasi. Di akun Threads Anda, jam dan gaya tulisnya mengikuti data dan posting akun itu sendiri.
      </p>
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
        Dipilih dari jam dengan views tertinggi, dijaga berjarak minimal 2,5 jam, dan menitnya digeser sedikit tiap hari supaya tidak
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
    text: "Tim saus dipisah atau tim langsung disiram? Jawab jujur, ini menentukan pertemanan.",
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
    text: "Diskon 50% semua menu khusus hari ini! Buruan sebelum kehabisan, cuma Rp9.000 saja.",
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
    text: "Tim saus dipisah atau tim disiram langsung? Jawab jujur ya, ini menentukan pertemanan kita.",
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
