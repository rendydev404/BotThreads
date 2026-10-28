import React, { useMemo } from "react";
import { AbsoluteFill, Easing, Html5Audio, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { Ban, BadgeCheck, CalendarClock, Check, Flame, Heart, MessageCircle, PenLine, Radar, Repeat2, Send, ShieldCheck, TrendingUp } from "lucide-react";

/**
 * Film pendek "satu hari autopilot" untuk halaman perkenalan, dimainkan oleh Remotion Player di browser.
 * Isinya contoh tulisan tangan (bukan data pelanggan), tetapi urutannya mengikuti sistem: tren dipindai,
 * draf ditulis, diperiksa, diantrekan di jam ramai, terbit, lalu hasilnya dipelajari.
 * Semua gerak dihitung dari useCurrentFrame(); tanpa animasi/transisi CSS.
 */

export const FILM_FPS = 30;
export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;

const T = 15; // panjang transisi antaradegan (frame)
const SCENES = [90, 120, 120, 105, 120, 135, 90] as const;
const STARTS = SCENES.map((_, i) => SCENES.slice(0, i).reduce((a, b) => a + b, 0) - i * T);
export const FILM_DURATION = SCENES.reduce((a, b) => a + b, 0) - (SCENES.length - 1) * T;

// Palet tetap gelap supaya film terlihat sama di mode terang maupun gelap (diturunkan dari token .dark).
const C = {
  bg: "#06070d",
  panel: "rgba(20, 23, 34, 0.86)",
  panelSolid: "#141722",
  line: "#252a3a",
  lineStrong: "#343a4f",
  fg: "#eef0f8",
  muted: "#a0a6bd",
  faint: "#6f7690",
  accent: "#7b8aff",
  cyan: "#4fd8ff",
  success: "#3dd6a0",
  warning: "#f0b955",
  danger: "#ff7a8c",
};
const DISPLAY = "var(--font-bricolage), var(--font-plus-jakarta), system-ui, sans-serif";
const SANS = "var(--font-plus-jakarta), system-ui, sans-serif";
const MONO = "var(--font-jetbrains), ui-monospace, Consolas, monospace";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const fmtNum = (n: number, locale: string) => Math.round(n).toLocaleString(locale);
/** Skor 0-1 dengan dua desimal: koma di bahasa Indonesia ("0,87"), titik di bahasa Inggris ("0.87"). */
const fmtScore = (n: number, lang: string) => (lang === "en" ? n.toFixed(2) : n.toFixed(2).replace(".", ","));

/** Masuk halus (0 -> 1) setelah `delay` frame. */
function useEnter(delay = 0, damping = 200) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
}

function rise(p: number, dist = 28): React.CSSProperties {
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` };
}

/* ------------------------------------------------------------------ latar & HUD */

function Backdrop() {
  const frame = useCurrentFrame();
  const scan = (frame * 4) % (FILM_HEIGHT + 200);
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          backgroundPosition: `0 ${(frame * 0.8) % 48}px`,
          opacity: 0.45,
          maskImage: "radial-gradient(ellipse 75% 70% at 50% 45%, #000 30%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 50% 45%, #000 30%, transparent 85%)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(520px circle at ${30 + Math.sin(frame / 50) * 8}% 30%, rgba(123,138,255,0.22), transparent 70%), radial-gradient(480px circle at ${72 + Math.cos(frame / 60) * 6}% 75%, rgba(79,216,255,0.13), transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scan - 100,
          height: 100,
          background: "linear-gradient(to bottom, transparent, rgba(123,138,255,0.07), transparent)",
        }}
      />
    </AbsoluteFill>
  );
}

const PIPELINE = ["Tren", "Ide", "Tulis", "Periksa", "Antre", "Terbit"];
// Tahap alur kerja yang sedang menyala pada tiap adegan (indeks PIPELINE; -1 = belum mulai, 6 = semua selesai).
const SCENE_STEP = [-1, 1, 2, 3, 4, 5, 6];

/** Jam simulasi di pojok: 06.00 saat tren dipindai, 22.00 saat hasil dipelajari. */
function clockAt(frame: number): string {
  const minutes = interpolate(
    frame,
    // Jam berhenti di tiap adegan dan baru melompat saat transisi, supaya cocok dengan judul adegannya.
    [0, STARTS[2], STARTS[2] + T, STARTS[3] + T, STARTS[4] + T, STARTS[5], STARTS[5] + T, STARTS[5] + 70, STARTS[6] + T],
    [360, 364, 642, 644, 645, 732, 732, 1320, 1320],
    CLAMP
  );
  const m = Math.floor(minutes);
  return `${pad(Math.floor(m / 60))}.${pad(m % 60)}`;
}

function Hud() {
  const frame = useCurrentFrame();
  const t = useT();
  let scene = 0;
  STARTS.forEach((s, i) => {
    if (frame >= s + T / 2) scene = i;
  });
  const step = SCENE_STEP[scene];
  const live = 0.45 + 0.55 * Math.abs(Math.sin(frame / 9));

  return (
    <AbsoluteFill style={{ pointerEvents: "none", fontFamily: MONO }}>
      <div style={{ position: "absolute", top: 34, left: 64, display: "flex", alignItems: "center", gap: 12, color: C.muted, fontSize: 17, fontWeight: 700, letterSpacing: 2 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: C.success, opacity: live, boxShadow: `0 0 12px ${C.success}` }} />
        BOTTHREADS · AUTOPILOT
      </div>
      <div
        style={{
          position: "absolute",
          top: 26,
          right: 64,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          borderRadius: 10,
          border: `1px solid ${C.lineStrong}`,
          background: "rgba(12,14,22,0.7)",
          color: C.fg,
          fontSize: 20,
          fontWeight: 700,
        }}
      >
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{clockAt(frame)}</span>
        <span style={{ color: C.faint, fontSize: 14 }}>WIB</span>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, display: "flex", justifyContent: "center", gap: 8 }}>
        {PIPELINE.map((label, i) => {
          const done = i < step;
          const on = i === step;
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: 1,
                color: on ? C.bg : done ? C.fg : C.faint,
                background: on ? C.accent : done ? "rgba(123,138,255,0.16)" : "rgba(20,23,34,0.7)",
                border: `1px solid ${on ? C.accent : done ? "rgba(123,138,255,0.4)" : C.line}`,
                boxShadow: on ? `0 0 24px rgba(123,138,255,0.55)` : "none",
              }}
            >
              {done ? <Check size={14} strokeWidth={3} /> : <span style={{ fontVariantNumeric: "tabular-nums" }}>0{i + 1}</span>}
              {t(`${label}@@pipeline`).toUpperCase()}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** Judul adegan: label mono kecil + judul besar. */
function SceneTitle({ kicker, title, Icon }: { kicker: string; title: string; Icon: typeof Radar }) {
  const t = useT();
  const a = useEnter(0);
  const b = useEnter(5);
  return (
    <div style={{ position: "absolute", top: 92, left: 72, right: 72 }}>
      <div style={{ ...rise(a, 14), display: "flex", alignItems: "center", gap: 10, color: C.cyan, fontFamily: MONO, fontSize: 18, fontWeight: 700, letterSpacing: 3 }}>
        <Icon size={20} strokeWidth={2.5} />
        {t(kicker)}
      </div>
      <div style={{ ...rise(b, 20), marginTop: 10, color: C.fg, fontFamily: DISPLAY, fontSize: 50, fontWeight: 800, letterSpacing: -1.6, lineHeight: 1.02 }}>{t(title)}</div>
    </div>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${C.lineStrong}`,
        background: C.panel,
        boxShadow: "0 30px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ 1. pembuka */

const BOOT = ["menghubungkan @kedai.sore", "memuat Pengetahuan brand", "membaca jam ramai 30 hari", "autopilot siap"];

function IntroScene() {
  const frame = useCurrentFrame();
  const t = useT();
  const logo = useEnter(0, 14);
  const head = useEnter(18);
  const sub = useEnter(30);
  const ring = interpolate(frame, [0, 90], [0, 360]);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: SANS }}>
      <div style={{ position: "relative", width: 132, height: 132, transform: `scale(${0.6 + logo * 0.4})`, opacity: logo }}>
        <div
          style={{
            position: "absolute",
            inset: -14,
            borderRadius: 44,
            background: `conic-gradient(from ${ring}deg, ${C.accent}, ${C.cyan}, transparent 45%, ${C.accent})`,
            filter: "blur(10px)",
            opacity: 0.8,
          }}
        />
        <Img src="/logo.webp" style={{ position: "relative", width: 132, height: 132, borderRadius: 34 }} />
      </div>
      <div style={{ ...rise(head), marginTop: 40, fontFamily: DISPLAY, fontSize: 64, fontWeight: 800, color: C.fg, letterSpacing: -2, textAlign: "center", lineHeight: 1 }}>
        {t("Satu hari kerja tim konten.")}
      </div>
      <div style={{ ...rise(sub), marginTop: 14, fontFamily: DISPLAY, fontSize: 40, fontWeight: 700, letterSpacing: -1.2, color: C.accent }}>
        {t("Dikerjakan autopilot, sendiri.")}
      </div>
      <div style={{ marginTop: 34, display: "flex", gap: 22, fontFamily: MONO, fontSize: 16, fontWeight: 700 }}>
        {BOOT.map((line, i) => {
          const p = interpolate(frame, [36 + i * 9, 44 + i * 9], [0, 1], CLAMP);
          const last = i === BOOT.length - 1;
          return (
            <span key={line} style={{ opacity: p, color: last ? C.success : C.muted, display: "flex", alignItems: "center", gap: 6 }}>
              <Check size={15} strokeWidth={3} color={C.success} />
              {t(line)}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 2. tren dipindai */

const SIGNALS = [
  { from: "Google Trends ID", text: "“gajian tanggal 25”", stat: "+320%", color: C.cyan },
  { from: "Posting terbaik Anda", text: "“tim saus dipisah”", stat: "48rb views", color: C.accent },
  { from: "Kalender momen", text: "Jumat gajian", stat: "H-0", color: C.warning },
  { from: "Catatan Anda", text: "Menu baru: sambal matah", stat: "baru", color: C.success },
];
const IDEAS = [
  { text: "gajian dateng, siapa yang ditraktir malem ini?", score: 0.92 },
  { text: "debat abadi: saus dipisah apa disiram", score: 0.81 },
  { text: "sambal matah baru, pedesnya level berapa?", score: 0.74 },
];

function ScanScene() {
  const frame = useCurrentFrame();
  const { t, lang } = useLang();
  const sweep = frame * 5;
  const blips = [
    { x: 58, y: 34, at: 14 },
    { x: 30, y: 62, at: 26 },
    { x: 70, y: 70, at: 38 },
    { x: 40, y: 28, at: 50 },
  ];

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <SceneTitle kicker="06.00 · TREN DIPANTAU" title="Mencari bahan dari 4 sumber." Icon={Radar} />

      {/* radar */}
      <div style={{ position: "absolute", left: 72, top: 236, width: 330, height: 330, borderRadius: "50%", border: `1px solid ${C.lineStrong}`, overflow: "hidden", background: "rgba(79,216,255,0.03)" }}>
        {[0.33, 0.66].map((r) => (
          <div key={r} style={{ position: "absolute", inset: `${(r * 100) / 2}%`, borderRadius: "50%", border: `1px solid ${C.line}` }} />
        ))}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: C.line }} />
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: C.line }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `conic-gradient(from ${sweep}deg, rgba(79,216,255,0.45), rgba(79,216,255,0) 22%, transparent)`,
          }}
        />
        {blips.map((b, i) => {
          const p = spring({ frame: frame - b.at, fps: FILM_FPS, config: { damping: 12 } });
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: 14,
                height: 14,
                marginLeft: -7,
                marginTop: -7,
                borderRadius: 14,
                background: SIGNALS[i].color,
                transform: `scale(${p})`,
                boxShadow: `0 0 18px ${SIGNALS[i].color}`,
              }}
            />
          );
        })}
      </div>

      {/* sinyal masuk */}
      <div style={{ position: "absolute", left: 440, top: 236, width: 360, display: "flex", flexDirection: "column", gap: 12 }}>
        {SIGNALS.map((s, i) => {
          const p = spring({ frame: frame - (14 + i * 12), fps: FILM_FPS, config: { damping: 200 } });
          return (
            <Panel key={s.from} style={{ padding: "14px 18px", opacity: p, transform: `translateX(${(1 - p) * -40}px)`, borderColor: `${s.color}55` }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 14, fontWeight: 700, color: s.color }}>
                <span>{t(s.from).toUpperCase()}</span>
                <span>{t(s.stat)}</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 21, fontWeight: 700, color: C.fg }}>{t(s.text)}</div>
            </Panel>
          );
        })}
      </div>

      {/* ide dinilai */}
      <div style={{ position: "absolute", right: 72, top: 236, width: 360 }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 2, opacity: interpolate(frame, [56, 64], [0, 1], CLAMP) }}>
          {t("IDE DINILAI")}
        </div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {IDEAS.map((idea, i) => {
            const p = spring({ frame: frame - (60 + i * 8), fps: FILM_FPS, config: { damping: 200 } });
            const bar = interpolate(frame, [66 + i * 8, 92 + i * 8], [0, idea.score], { ...CLAMP, easing: Easing.out(Easing.cubic) });
            const top = i === 0;
            const glow = top ? interpolate(frame, [96, 108], [0, 1], CLAMP) : 0;
            return (
              <Panel
                key={idea.text}
                style={{
                  padding: "14px 18px",
                  ...rise(p, 20),
                  borderColor: glow ? C.accent : C.lineStrong,
                  boxShadow: glow ? `0 0 ${30 * glow}px rgba(123,138,255,${0.5 * glow})` : undefined,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, color: C.fg, lineHeight: 1.25 }}>{t(idea.text)}</div>
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 6, background: C.line, overflow: "hidden" }}>
                    <div style={{ width: `${bar * 100}%`, height: "100%", background: top ? `linear-gradient(90deg, ${C.accent}, ${C.cyan})` : C.lineStrong }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: top ? C.cyan : C.muted, fontVariantNumeric: "tabular-nums" }}>
                    {fmtScore(bar, lang)}
                  </span>
                </div>
              </Panel>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 3. AI menulis */

const DRAFT = "tanggal 25, dompet senyum lagi 😌 yang kemarin ngomong mau hemat, malem ini traktir siapa nih? sambal matah baru udah nungguin";

function ThreadsCard({ text, cursor, meta, style }: { text: string; cursor?: boolean; meta: string; style?: React.CSSProperties }) {
  return (
    <Panel style={{ padding: 28, background: C.panelSolid, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Img src="/logo.webp" style={{ width: 52, height: 52, borderRadius: 52 }} />
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: C.fg }}>kedai.sore</div>
          <div style={{ fontSize: 16, color: C.faint }}>{meta}</div>
        </div>
      </div>
      <div style={{ marginTop: 18, fontSize: 27, lineHeight: 1.4, color: C.fg, fontWeight: 500, minHeight: 152 }}>
        {text}
        {cursor ? <span style={{ display: "inline-block", width: 3, height: 30, marginLeft: 3, verticalAlign: "-5px", background: C.accent }} /> : null}
      </div>
    </Panel>
  );
}

function WriteScene() {
  const frame = useCurrentFrame();
  const t = useT();
  // Per karakter tampilan (emoji = satu karakter), supaya efek mengetik tidak memotong emoji di tengah.
  // Dihitung dari teks dalam bahasa aktif; kecepatan mengetik menyesuaikan panjangnya (frame 18-98).
  const draftChars = useMemo(() => Array.from(t(DRAFT)), [t]);
  const chars = Math.floor(interpolate(frame, [18, 98], [0, draftChars.length], CLAMP));
  const blink = Math.floor(frame / 8) % 2 === 0 || chars < draftChars.length;
  const tags = [
    { k: "SUARA BRAND", v: "santai, jenaka" },
    { k: "BAHAN", v: "Momen gajian + menu baru" },
    { k: "JAM TAYANG", v: "12.12 · jam makan siang" },
  ].map((tag) => ({ k: t(tag.k), v: t(tag.v) }));
  const card = useEnter(6);

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <SceneTitle kicker="10.42 · DRAF DITULIS" title="AI menulis dengan suara brand Anda." Icon={PenLine} />
      <div style={{ position: "absolute", left: 72, top: 238, width: 700, ...rise(card, 30) }}>
        <ThreadsCard text={draftChars.slice(0, chars).join("")} cursor={blink} meta={t("draf · menulis…")} />
      </div>
      <div style={{ position: "absolute", right: 72, top: 238, width: 380, display: "flex", flexDirection: "column", gap: 14 }}>
        {tags.map((tag, i) => {
          const p = spring({ frame: frame - (24 + i * 14), fps: FILM_FPS, config: { damping: 200 } });
          return (
            <Panel key={tag.k} style={{ padding: "16px 20px", opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
              <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.cyan, letterSpacing: 2 }}>{tag.k}</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700, color: C.fg }}>{tag.v}</div>
            </Panel>
          );
        })}
        <div style={{ fontFamily: MONO, fontSize: 16, color: C.muted, opacity: interpolate(frame, [70, 80], [0, 1], CLAMP), paddingLeft: 4 }}>
          {t("{n} karakter · tanpa harga yang tidak ada di Pengetahuan", { n: chars })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 4. pemeriksaan */

const CHECKS = ["Bentuk & panjang tulisan", "Harga & promo sesuai Pengetahuan", "Bebas topik terlarang", "Tidak kembar dengan akun lain"];

function GateScene() {
  const frame = useCurrentFrame();
  const { t, lang } = useLang();
  const score = interpolate(frame, [52, 88], [0, 0.87], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const R = 92;
  const circ = 2 * Math.PI * R;
  const pass = spring({ frame: frame - 88, fps: FILM_FPS, config: { damping: 11 } });

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <SceneTitle kicker="10.44 · DRAF DIPERIKSA" title="Tidak semua draf boleh terbit." Icon={ShieldCheck} />
      <div style={{ position: "absolute", left: 72, top: 240, width: 640, display: "flex", flexDirection: "column", gap: 14 }}>
        {CHECKS.map((c, i) => {
          const at = 10 + i * 11;
          const p = spring({ frame: frame - at, fps: FILM_FPS, config: { damping: 200 } });
          const ok = spring({ frame: frame - (at + 8), fps: FILM_FPS, config: { damping: 12 } });
          const scanning = frame >= at && frame < at + 8;
          return (
            <Panel key={c} style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 16, ...rise(p, 18) }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: ok > 0.1 ? "rgba(61,214,160,0.15)" : C.line,
                  color: C.success,
                }}
              >
                <div style={{ transform: `scale(${ok})` }}>
                  <Check size={22} strokeWidth={3} />
                </div>
              </div>
              <div style={{ flex: 1, fontSize: 23, fontWeight: 700, color: C.fg }}>{t(c)}</div>
              <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: scanning ? C.cyan : C.success, opacity: p }}>{scanning ? t("MEMERIKSA") : ok > 0.5 ? t("LOLOS") : ""}</div>
            </Panel>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: MONO, fontSize: 15, color: C.faint, opacity: interpolate(frame, [58, 66], [0, 1], CLAMP) }}>
          <Ban size={16} color={C.danger} /> {t("2 draf lain hari ini ditolak dan ditulis ulang")}
        </div>
      </div>

      <div style={{ position: "absolute", right: 110, top: 250, width: 300, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative", width: 230, height: 230 }}>
          <svg width={230} height={230} viewBox="0 0 230 230" style={{ transform: "rotate(-90deg)" }}>
            <circle cx={115} cy={115} r={R} stroke={C.line} strokeWidth={14} fill="none" />
            <circle
              cx={115}
              cy={115}
              r={R}
              stroke="url(#gauge)"
              strokeWidth={14}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - score)}
            />
            <defs>
              <linearGradient id="gauge" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={C.accent} />
                <stop offset="100%" stopColor={C.cyan} />
              </linearGradient>
            </defs>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 62, fontWeight: 800, color: C.fg, fontVariantNumeric: "tabular-nums" }}>{fmtScore(score, lang)}</div>
            <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.muted, letterSpacing: 2 }}>{t("SKOR EDITOR AI")}</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 20px",
            borderRadius: 999,
            background: C.success,
            color: C.bg,
            fontFamily: MONO,
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 2,
            transform: `scale(${pass})`,
            boxShadow: "0 0 30px rgba(61,214,160,0.5)",
          }}
        >
          <BadgeCheck size={20} /> {t("LOLOS · MASUK ANTREAN")}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 5. antre di jam ramai */

const HOURS = [8, 4, 2, 1, 1, 3, 9, 16, 21, 18, 22, 41, 58, 37, 20, 19, 27, 44, 62, 71, 66, 48, 30, 15];
const SLOTS = [
  { hour: 12, label: "12.12" },
  { hour: 17, label: "17.40" },
  { hour: 20, label: "20.15" },
];

function ScheduleScene() {
  const frame = useCurrentFrame();
  const t = useT();
  const max = Math.max(...HOURS);
  const chartW = 760;
  const chartH = 250;
  const gap = 8;
  const barW = (chartW - gap * 23) / 24;

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <SceneTitle kicker="10.45 · ANTRE DI JAM RAMAI" title="Jam tayang dihitung, bukan ditebak." Icon={CalendarClock} />
      <Panel style={{ position: "absolute", left: 72, top: 236, width: chartW + 56, height: 360, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 2 }}>
          <span>{t("RATA-RATA VIEWS PER JAM · 30 HARI")}</span>
          <span style={{ color: C.cyan }}>{t("JEDA MIN. 2,5 JAM")}</span>
        </div>
        <div style={{ position: "relative", marginTop: 18, height: chartH, display: "flex", alignItems: "flex-end", gap }}>
          {HOURS.map((v, h) => {
            const grow = spring({ frame: frame - (6 + h * 1.4), fps: FILM_FPS, config: { damping: 200 } });
            const slot = SLOTS.find((s) => s.hour === h);
            const lit = slot ? interpolate(frame, [52 + SLOTS.indexOf(slot) * 12, 62 + SLOTS.indexOf(slot) * 12], [0, 1], CLAMP) : 0;
            return (
              <div
                key={h}
                style={{
                  width: barW,
                  height: (v / max) * chartH * grow,
                  borderRadius: 6,
                  background: lit ? `linear-gradient(to top, ${C.accent}, ${C.cyan})` : C.lineStrong,
                  opacity: slot ? 0.5 + lit * 0.5 : 0.75,
                  boxShadow: lit ? `0 0 ${22 * lit}px rgba(79,216,255,${0.55 * lit})` : "none",
                }}
              />
            );
          })}
          {SLOTS.map((s, i) => {
            const drop = spring({ frame: frame - (52 + i * 12), fps: FILM_FPS, config: { damping: 13 } });
            const x = s.hour * (barW + gap) + barW / 2;
            const y = chartH - (HOURS[s.hour] / max) * chartH - 46;
            return (
              <div
                key={s.label}
                style={{
                  position: "absolute",
                  left: x,
                  top: y - (1 - drop) * 60,
                  transform: "translateX(-50%)",
                  opacity: drop,
                  padding: "5px 10px",
                  borderRadius: 8,
                  background: C.fg,
                  color: C.bg,
                  fontFamily: MONO,
                  fontSize: 15,
                  fontWeight: 800,
                }}
              >
                {s.label}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 13, color: C.faint }}>
          {["00", "06", "12", "18", "23"].map((h) => (
            <span key={h}>{h}.00</span>
          ))}
        </div>
      </Panel>

      <div style={{ position: "absolute", right: 72, top: 236, width: 300 }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 2 }}>{t("ANTREAN HARI INI")}</div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 12 }}>
          {SLOTS.map((s, i) => {
            const p = spring({ frame: frame - (60 + i * 12), fps: FILM_FPS, config: { damping: 200 } });
            return (
              <Panel key={s.label} style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, ...rise(p, 18), borderColor: i === 0 ? C.accent : C.lineStrong }}>
                <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: i === 0 ? C.cyan : C.fg }}>{s.label}</span>
                <span style={{ fontSize: 16, color: C.muted, fontWeight: 600 }}>{i === 0 ? t("draf gajian · lolos") : t("ditulis 90 mnt sebelumnya")}</span>
              </Panel>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 6. terbit & hasil */

function PublishScene() {
  const frame = useCurrentFrame();
  const { t, locale } = useLang();
  const card = useEnter(4, 16);
  const ease = { ...CLAMP, easing: Easing.out(Easing.cubic) };
  const views = interpolate(frame, [24, 110], [0, 48213], ease);
  const likes = interpolate(frame, [30, 110], [0, 2317], ease);
  const replies = interpolate(frame, [34, 110], [0, 184], ease);
  const toast = spring({ frame: frame - 82, fps: FILM_FPS, config: { damping: 14 } });

  // Garis views: titik-titik naik mengikuti hitungan.
  const pts = Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    const v = Math.pow(t, 1.8) * (0.85 + 0.15 * Math.sin(i * 1.7));
    return [t * 400, 120 - v * 110] as const;
  });
  const shown = interpolate(frame, [24, 110], [0, 1], ease);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

  return (
    <AbsoluteFill style={{ fontFamily: SANS }}>
      <SceneTitle kicker="12.12 · TERBIT DI THREADS" title="Tepat di jamnya. Lalu dipelajari." Icon={Send} />
      <div style={{ position: "absolute", left: 72, top: 236, width: 640, opacity: card, transform: `translateY(${(1 - card) * 60}px) scale(${0.94 + card * 0.06})` }}>
        <ThreadsCard text={t(DRAFT)} meta={t("12.12 · baru saja · lewat API resmi Threads")} style={{ borderColor: "rgba(123,138,255,0.55)" }} />
        <div style={{ marginTop: 16, display: "flex", gap: 26, paddingLeft: 8, fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.muted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Heart size={20} color={C.danger} fill={C.danger} /> {fmtNum(likes, locale)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MessageCircle size={20} /> {fmtNum(replies, locale)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Repeat2 size={20} /> {fmtNum(replies * 0.6, locale)}
          </span>
        </div>
      </div>

      <Panel style={{ position: "absolute", right: 72, top: 236, width: 440, padding: 22 }}>
        <div style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.faint, letterSpacing: 2 }}>{t("VIEWS SEJAK TERBIT")}</div>
        <div style={{ marginTop: 4, fontFamily: DISPLAY, fontSize: 58, fontWeight: 800, color: C.fg, fontVariantNumeric: "tabular-nums", letterSpacing: -1.5 }}>{fmtNum(views, locale)}</div>
        <svg width={400} height={124} viewBox="0 0 400 124" style={{ marginTop: 6, overflow: "visible" }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={C.accent} />
              <stop offset="100%" stopColor={C.cyan} />
            </linearGradient>
          </defs>
          <path d={path} fill="none" stroke="url(#spark)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - shown} />
        </svg>
      </Panel>

      <div
        style={{
          position: "absolute",
          right: 72,
          top: 500,
          width: 440,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 18px",
          borderRadius: 16,
          background: "rgba(240,185,85,0.12)",
          border: `1px solid ${C.warning}`,
          opacity: toast,
          transform: `translateX(${(1 - toast) * 80}px)`,
        }}
      >
        <Flame size={28} color={C.warning} />
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.fg }}>{t("3,4× di atas rata-rata akun")}</div>
          <div style={{ fontSize: 15, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingUp size={14} /> {t("ide lanjutan dibuat untuk besok")}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ 7. penutup */

function OutroScene() {
  const frame = useCurrentFrame();
  const t = useT();
  const a = useEnter(0, 14);
  const b = useEnter(10);
  const c = useEnter(22);
  const glow = 0.6 + 0.4 * Math.sin(frame / 10);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: SANS, textAlign: "center" }}>
      <Img src="/logo.webp" style={{ width: 96, height: 96, borderRadius: 26, opacity: a, transform: `scale(${0.7 + a * 0.3})`, boxShadow: `0 0 ${50 * glow}px rgba(123,138,255,0.6)` }} />
      <div style={{ ...rise(b), marginTop: 30, fontFamily: DISPLAY, fontSize: 68, fontWeight: 800, color: C.fg, letterSpacing: -2.2, lineHeight: 1 }}>
        {t("Threads Anda posting sendiri,")}
        <br />
        <span style={{ backgroundImage: `linear-gradient(90deg, ${C.accent}, ${C.cyan})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{t("setiap hari.")}</span>
      </div>
      <div style={{ ...rise(c), marginTop: 22, fontFamily: MONO, fontSize: 20, fontWeight: 700, color: C.muted, letterSpacing: 1 }}>
        {t("Mulai dari satu akun, mode Tinjau dulu.")}
      </div>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ komposisi */

/**
 * `sound`: soundtrack (musik + efek, lihat scripts/gen-film-audio.mjs) baru dipasang saat pengunjung
 * menyalakan suara, jadi file audionya tidak diunduh oleh yang menonton tanpa suara.
 */
export function AutopilotFilm({ sound = false }: { sound?: boolean }) {
  const timing = linearTiming({ durationInFrames: T });
  const scenes = [IntroScene, ScanScene, WriteScene, GateScene, ScheduleScene, PublishScene, OutroScene];
  const presentations = [
    fade(),
    slide({ direction: "from-right" }),
    wipe({ direction: "from-left" }),
    slide({ direction: "from-bottom" }),
    slide({ direction: "from-right" }),
    fade(),
  ] as TransitionPresentation<Record<string, unknown>>[];

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {sound ? <Html5Audio src={staticFile("film/autopilot.mp3")} volume={0.85} /> : null}
      <Backdrop />
      <TransitionSeries>
        {scenes.flatMap((Scene, i) => {
          const items = [
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={SCENES[i]}>
              <Scene />
            </TransitionSeries.Sequence>,
          ];
          if (i < scenes.length - 1) items.push(<TransitionSeries.Transition key={`t${i}`} presentation={presentations[i]} timing={timing} />);
          return items;
        })}
      </TransitionSeries>
      <Hud />
    </AbsoluteFill>
  );
}
