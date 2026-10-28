"use client";

import { useEffect, useState } from "react";
import { Bell, ChartLine, Check, ClipboardCheck, Clock, Eye, Loader2, RefreshCw, RotateCcw, SlidersHorizontal, UserPlus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { ThreadsMark } from "./threads-mark";

/**
 * Peraga "Cara mulai": empat langkah pengguna baru. Langkah berganti sendiri tiap 6 detik (bar progres CSS,
 * lihat .lp-step-fill di landing.css) sampai pengunjung mengklik langkah atau mencoba peraganya.
 * Semua isinya contoh tulisan tangan, bukan data pelanggan.
 */

const STEPS = [
  { Icon: UserPlus, title: "Daftar & hubungkan", body: "Buat akun, lalu sambungkan akun Threads lewat login resmi Threads.", path: "/akun" },
  { Icon: SlidersHorizontal, title: "Atur profil brand", body: "Isi niche, gaya bahasa, serta harga dan promo sebagai acuan AI.", path: "/pengaturan" },
  { Icon: ClipboardCheck, title: "Pilih mode", body: "Tinjau dulu: Anda menyetujui tiap draf. Otomatis: editor AI yang menilai, lalu terbit di jam ramai.", path: "/autopilot" },
  { Icon: ChartLine, title: "Pantau hasil", body: "Lihat views dan jam terbaik tiap akun. AI belajar dari hasilnya setiap hari.", path: "/" },
];

export function OnboardingFlow() {
  const t = useT();
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const pick = (i: number) => {
    setAuto(false);
    setStep(i);
  };

  return (
    <div className="lp-flow grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-4 lg:gap-6 items-start">
      <div role="tablist" aria-label={t("Langkah memulai")} aria-orientation="vertical" className="grid gap-2">
        {STEPS.map(({ Icon, title, body }, i) => {
          const on = step === i;
          const done = i < step;
          return (
            <button
              key={title}
              type="button"
              role="tab"
              id={`mulai-tab-${i}`}
              aria-selected={on}
              aria-controls="mulai-panel"
              onClick={() => pick(i)}
              className={cn(
                "group relative overflow-hidden text-left rounded-2xl border p-4 sm:p-5 transition-colors cursor-pointer",
                on ? "border-accent bg-surface shadow-pop" : "border-line bg-surface/60 hover:bg-surface"
              )}
            >
              <div className={cn("flex gap-4", on ? "items-start" : "items-center")}>
                <span
                  className={cn(
                    "lp-display shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-lg font-extrabold tabular-nums transition-colors",
                    on ? "bg-accent text-on-accent" : done ? "bg-accent-soft text-accent" : "bg-subtle text-muted"
                  )}
                >
                  {done ? <Check className="w-5 h-5" /> : `0${i + 1}`}
                </span>
                <div className="min-w-0">
                  <p className={cn("flex items-center gap-2 text-[15px] font-bold", !on && "text-muted group-hover:text-fg")}>
                    <Icon className={cn("w-4 h-4 shrink-0", on ? "text-accent" : "text-faint")} />
                    {t(title)}
                  </p>
                  <p
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-300",
                      on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    )}
                  >
                    <span className="overflow-hidden text-sm text-muted leading-relaxed pt-1">{t(body)}</span>
                  </p>
                </div>
              </div>
              {on && (
                <span aria-hidden="true" className="absolute left-0 bottom-0 h-[3px] w-full bg-accent/15">
                  <span
                    key={`${step}-${auto}`}
                    className={cn("block h-full w-full bg-accent", auto ? "lp-step-fill" : "")}
                    onAnimationEnd={() => setStep((s) => (s + 1) % STEPS.length)}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Layar contoh: mengikuti langkah aktif, bisa dicoba. Mencoba = menghentikan pergantian otomatis. */}
      <div
        id="mulai-panel"
        role="tabpanel"
        aria-labelledby={`mulai-tab-${step}`}
        onPointerDown={() => setAuto(false)}
        className="rounded-3xl border border-line bg-canvas shadow-pop overflow-hidden"
      >
        <div className="flex items-center gap-2 h-10 px-4 border-b border-line bg-surface">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-warning/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
          <span className="lp-mono ml-3 text-[11px] font-bold text-faint truncate">BotThreads · {STEPS[step].path}</span>
        </div>
        <div key={step} className="lp-panel p-5 sm:p-7 min-h-[22rem]">
          {step === 0 && <ConnectDemo />}
          {step === 1 && <BrandDemo />}
          {step === 2 && <ModeDemo />}
          {step === 3 && <MonitorDemo />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 01 hubungkan */

const ACCOUNTS = ["@kedai.sore", "@kedai.sore.bandung", "@kedai.sore.depok"];

function ConnectDemo() {
  const t = useT();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const connect = () => {
    if (state !== "idle") return;
    setState("loading");
    window.setTimeout(() => setState("done"), 900);
  };

  return (
    <div>
      <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">{t("AKUN THREADS")}</p>
      <h3 className="lp-display mt-2 text-2xl font-extrabold">{t("Sambungkan akun brand Anda")}</h3>
      <p className="mt-1.5 text-sm text-muted">{t("Login lewat halaman resmi Threads. Kata sandi tidak pernah kami simpan.")}</p>
      <button
        type="button"
        onClick={connect}
        disabled={state !== "idle"}
        className="mt-5 inline-flex items-center gap-2.5 h-11 px-5 rounded-xl bg-fg text-canvas text-sm font-semibold disabled:opacity-70 cursor-pointer disabled:cursor-default"
      >
        {state === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThreadsMark className="w-4 h-4" />}
        {state === "done" ? t("Terhubung") : state === "loading" ? t("Menghubungkan…") : t("Hubungkan akun Threads")}
      </button>
      <ul className="mt-6 grid gap-2">
        {ACCOUNTS.map((a, i) => (
          <li
            key={a}
            className={cn(
              "flex items-center justify-between h-12 px-4 rounded-xl border transition-all duration-500",
              state === "done" ? "border-line bg-surface opacity-100 translate-y-0" : "border-dashed border-line opacity-40"
            )}
            style={{ transitionDelay: state === "done" ? `${i * 120}ms` : "0ms" }}
          >
            <span className="text-sm font-semibold">{state === "done" ? a : t("Akun belum terhubung")}</span>
            {state === "done" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                <Check className="w-3.5 h-3.5" /> {t("Siap")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ 02 profil brand */

const NICHES = ["Kuliner", "Kopi", "Fashion", "Skincare"] as const;
const VOICES = ["aku/kamu", "gue/lo", "saya/Anda", "kita"] as const;
const SAMPLE: Record<(typeof NICHES)[number], Record<(typeof VOICES)[number], string>> = {
  Kuliner: {
    "aku/kamu": "kamu tim saus dipisah atau langsung disiram? jawab jujur ya",
    "gue/lo": "lo tim saus dipisah apa disiram? jawab jujur, ini penting",
    "saya/Anda": "Anda lebih suka saus dipisah atau langsung disiram?",
    kita: "kita tim saus dipisah atau disiram nih? ayo jujur bareng",
  },
  Kopi: {
    "aku/kamu": "jam 3 sore, kamu udah gelas kedua belum?",
    "gue/lo": "jam 3 sore, lo udah gelas kedua belum?",
    "saya/Anda": "Pukul 3 sore, sudah gelas kedua untuk Anda?",
    kita: "jam 3 sore, kita udah gelas kedua belum ya?",
  },
  Fashion: {
    "aku/kamu": "baju favorit kamu pasti yang nggak perlu disetrika, kan?",
    "gue/lo": "baju favorit lo pasti yang gak perlu disetrika, ngaku",
    "saya/Anda": "Pakaian favorit Anda mungkin yang tidak perlu disetrika.",
    kita: "baju favorit kita tuh yang gak perlu disetrika, setuju?",
  },
  Skincare: {
    "aku/kamu": "sunscreen kamu udah di-reapply siang ini?",
    "gue/lo": "sunscreen lo udah di-reapply belum siang ini?",
    "saya/Anda": "Sudahkah Anda mengoleskan ulang sunscreen siang ini?",
    kita: "siang ini kita udah reapply sunscreen belum?",
  },
};

/** Label gaya bahasa: pasangan kata ganti Indonesia tetap ditampilkan, EN menambah keterangannya. */
const VOICE_HINT: Record<(typeof VOICES)[number], string> = {
  "aku/kamu": "aku/kamu@@gaya",
  "gue/lo": "gue/lo@@gaya",
  "saya/Anda": "saya/Anda@@gaya",
  kita: "kita@@gaya",
};

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 px-3.5 rounded-lg border text-[13px] font-semibold transition-colors cursor-pointer",
        on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted hover:text-fg"
      )}
    >
      {children}
    </button>
  );
}

function BrandDemo() {
  const t = useT();
  const [niche, setNiche] = useState<(typeof NICHES)[number]>("Kuliner");
  const [voice, setVoice] = useState<(typeof VOICES)[number]>("aku/kamu");

  return (
    <div className="grid gap-5">
      <div>
        <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">{t("NICHE AKUN")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {NICHES.map((n) => (
            <Chip key={n} on={niche === n} onClick={() => setNiche(n)}>
              {t(`${n}@@niche`)}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">{t("GAYA BAHASA")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {VOICES.map((v) => (
            <Chip key={v} on={voice === v} onClick={() => setVoice(v)}>
              {t(VOICE_HINT[v])}
            </Chip>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="lp-mono text-[11px] font-bold tracking-widest text-accent">{t("CONTOH TULISAN AI")}</p>
        <p key={`${niche}-${voice}`} className="lp-swap mt-2 text-[15px] leading-relaxed">
          {t(SAMPLE[niche][voice])}
        </p>
      </div>
      <p className="text-[13px] text-muted">
        {t("Harga dan promo diambil dari halaman Pengetahuan. Yang tidak tercatat di sana tidak akan ditulis AI.")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ 03 pilih mode */

const MODES = [
  { key: "tinjau", Icon: Eye, label: "Tinjau dulu", hint: "Tidak ada yang terbit tanpa persetujuan Anda." },
  { key: "otomatis", Icon: Zap, label: "Otomatis (autopilot)", hint: "Tanpa klik, tapi tidak tanpa pemeriksaan: draf dicek aturan lalu dinilai editor AI. Yang tidak lolos ditulis ulang atau dilewati." },
] as const;

function ModeDemo() {
  const t = useT();
  const [mode, setMode] = useState<(typeof MODES)[number]["key"]>("tinjau");
  const active = MODES.find((m) => m.key === mode) ?? MODES[0];

  return (
    <div>
      <div role="radiogroup" aria-label={t("Mode autopilot")} className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-subtle">
        {MODES.map(({ key, Icon, label }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            onClick={() => setMode(key)}
            className={cn(
              "inline-flex items-center justify-center gap-2 h-10 px-3 rounded-lg text-[13px] font-semibold transition-colors cursor-pointer",
              mode === key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            )}
          >
            <Icon className={cn("w-4 h-4", mode === key && "text-accent")} />
            <span className="truncate">{t(label)}</span>
          </button>
        ))}
      </div>
      <p key={mode} className="lp-swap mt-3 text-[13px] text-muted">
        {t(active.hint)}
      </p>
      <div key={`panel-${mode}`} className="lp-panel mt-5">
        {mode === "tinjau" ? <ReviewDemo /> : <AutoDemo />}
      </div>
    </div>
  );
}

const AUTO_STAGES = [
  { time: "10.42", label: "Draf ditulis dengan suara brand" },
  { time: "10.42", label: "Lolos 4 cek aturan: fakta, panjang, topik, kemiripan" },
  { time: "10.43", label: "Editor AI menilai: skor 0,86 (minimal 0,7)" },
  { time: "10.43", label: "Masuk antrean terbit" },
  { time: "12.12", label: "Terbit di Threads, tanpa klik" },
];

/** Putar ulang = pasang ulang AutoRun (key berganti), jadi hitungan tahap mulai lagi dari nol. */
function AutoDemo() {
  const [run, setRun] = useState(0);
  return <AutoRun key={run} onReplay={() => setRun((r) => r + 1)} />;
}

function AutoRun({ onReplay }: { onReplay: () => void }) {
  const t = useT();
  const [done, setDone] = useState(0);
  useEffect(() => {
    const timers = AUTO_STAGES.map((_, i) => window.setTimeout(() => setDone(i + 1), 500 + i * 750));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">AUTOPILOT · @kedai.sore</p>
        <button
          type="button"
          onClick={onReplay}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-bold text-muted hover:text-fg hover:bg-subtle cursor-pointer transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" /> {t("Putar ulang")}
        </button>
      </div>
      <ol className="mt-4 relative grid gap-3 pl-1">
        {AUTO_STAGES.map(({ time, label }, i) => {
          const ok = i < done;
          const now = i === done;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={cn(
                  "shrink-0 w-8 h-8 rounded-full flex items-center justify-center border transition-colors duration-300",
                  ok ? "bg-accent border-accent text-on-accent" : now ? "border-accent text-accent" : "border-line text-faint"
                )}
              >
                {ok ? <Check className="w-4 h-4" /> : now ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
              </span>
              <span className={cn("lp-mono text-xs font-bold tabular-nums", ok ? "text-fg" : "text-faint")}>{time}</span>
              <span className={cn("text-sm transition-colors", ok ? "text-fg font-semibold" : "text-muted")}>{t(label)}</span>
            </li>
          );
        })}
      </ol>
      <div
        className={cn(
          "mt-5 rounded-2xl border p-4 transition-all duration-500",
          done === AUTO_STAGES.length ? "border-accent bg-accent-soft opacity-100" : "border-line opacity-40"
        )}
      >
        <div className="flex items-center gap-2 text-xs text-muted">
          <ThreadsMark className="w-4 h-4 text-fg" />
          <span className="font-semibold text-fg">@kedai.sore</span>
          <span>· 12.12 · {t("baru saja")}</span>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed">{t(DRAFTS[0])}</p>
      </div>
      <p className="mt-3 text-[13px] text-muted">{t("Posting tetap bisa dibatalkan dari halaman Jadwal sebelum jam tayangnya.")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ 03a tinjau dulu */

const DRAFTS = [
  "jam 11 tuh jam paling rawan. belum laper-laper amat, tapi udah buka aplikasi pesen makan tiap 5 menit",
  "pesanan paling sering jam segini: nasi + sambal matah. kamu biasanya pilih level berapa?",
];

function ReviewDemo() {
  const { t, lang } = useLang();
  const [draft, setDraft] = useState(0);
  const [status, setStatus] = useState<"wait" | "rewriting" | "approved">("wait");
  const rewrite = () => {
    setStatus("rewriting");
    window.setTimeout(() => {
      setDraft((d) => (d + 1) % DRAFTS.length);
      setStatus("wait");
    }, 800);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">{t("JADWAL HARI INI")} · @kedai.sore</p>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-bold",
            status === "approved" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
          )}
        >
          {status === "approved" ? <Check className="w-3.5 h-3.5" /> : null}
          {status === "approved" ? t("Dijadwalkan {jam}", { jam: "12.12" }) : t("Menunggu tinjauan")}
        </span>
      </div>
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-2 text-xs text-muted">
          <ThreadsMark className="w-4 h-4 text-fg" />
          <span className="font-semibold text-fg">@kedai.sore</span>
          <span>· {t("tayang {jam} WIB", { jam: "12.12" })}</span>
        </div>
        <p key={draft} className={cn("lp-swap mt-3 text-[15px] leading-relaxed", status === "rewriting" && "opacity-40")}>
          {t(DRAFTS[draft])}
        </p>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-success" /> {t("Lolos 4 cek")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="w-3.5 h-3.5 text-success" /> {t("Skor editor {skor}", { skor: lang === "en" ? "0.86" : "0,86" })}
          </span>
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatus("approved")}
          disabled={status !== "wait"}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-accent hover:bg-accent-hover text-on-accent text-sm font-semibold disabled:opacity-60 cursor-pointer disabled:cursor-default transition-colors"
        >
          <Check className="w-4 h-4" /> {t("Setujui")}
        </button>
        <button
          type="button"
          onClick={status === "approved" ? () => setStatus("wait") : rewrite}
          disabled={status === "rewriting"}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl border border-line bg-surface hover:bg-subtle text-sm font-semibold cursor-pointer disabled:cursor-default transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", status === "rewriting" && "animate-spin")} />
          {status === "approved" ? t("Batalkan") : t("Tulis ulang")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 04 pantau */

const VIEWS = [38, 52, 47, 66, 58, 81, 94];
const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const INSIGHTS = [
  { Icon: Clock, title: "Jam terbaik: 12.00 dan 19.00", body: "Dipakai otomatis untuk jadwal besok." },
  { Icon: Bell, title: "Posting Jumat views 3x biasanya", body: "Notifikasi dikirim dan ide lanjutannya disiapkan." },
];

function MonitorDemo() {
  const t = useT();
  const max = Math.max(...VIEWS);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="lp-mono text-[11px] font-bold tracking-widest text-faint">{t("VIEWS 7 HARI · CONTOH")}</p>
        <span className="lp-mono text-xs font-bold text-success">+147%</span>
      </div>
      <div className="mt-4 flex items-end gap-2 h-32">
        {VIEWS.map((v, i) => (
          <div key={DAYS[i]} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
            <span
              className="w-full rounded-t-md bg-accent/80 origin-bottom transition-transform duration-700"
              style={{ height: `${(v / max) * 100}%`, transitionDelay: `${i * 60}ms` }}
            />
            <span className="text-[10px] font-semibold text-faint">{t(DAYS[i])}</span>
          </div>
        ))}
      </div>
      <ul className="mt-6 grid gap-2">
        {INSIGHTS.map(({ Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="shrink-0 w-9 h-9 rounded-xl bg-accent-soft text-accent flex items-center justify-center">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{t(title)}</p>
              <p className="mt-0.5 text-xs text-muted leading-relaxed">{t(body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
