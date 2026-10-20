import React, { memo } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2, Sparkles } from "lucide-react";

/**
 * Animasi bagian pembuka: robot tertidur di meja, sementara di monitornya Threads berjalan sendiri.
 * Draf diketik, diperiksa, tombol Posting ditekan kursor "hantu", posting terbit, suka dan balasan
 * berdatangan. Tiga posting per putaran dan semua gerak periodik, jadi perulangannya mulus.
 *
 * Supaya ringan di ponsel: semua yang bergerak hanya memakai transform/opacity di lapisannya sendiri
 * (willChange), cahaya dibuat dari gradien yang diatur opacity-nya (bukan blur yang berubah ukuran),
 * dan bagian yang diam dibungkus memo sehingga tidak dirender ulang tiap frame.
 * Semua gerak dihitung dari useCurrentFrame() (tanpa animasi CSS), sesuai aturan Remotion.
 */

/**
 * Semua waktu di file ini memakai satuan "frame dasar" 30 fps. Player boleh berjalan lebih jarang
 * (mis. 20 fps di ponsel supaya hemat CPU): komposisi mengonversi frame Player ke frame dasar, jadi
 * kecepatan geraknya tetap sama, hanya jumlah gambar per detik yang berkurang.
 */
export const BASE_FPS = 30;
export const DESK_W = 760;
export const DESK_H = 840;
/** Satu posting = satu siklus; tiga siklus = satu putaran penuh (dalam frame dasar). */
export const CYCLE = 150;
export const DESK_DURATION = CYCLE * 3;
/** Panjang putaran dalam frame Player untuk fps tertentu. */
export const deskFrames = (fps: number) => Math.round((DESK_DURATION * fps) / BASE_FPS);
/** Frame Player -> frame dasar. */
export const toBaseFrame = (frame: number, fps: number) => (frame * BASE_FPS) / fps;
/** Frame dalam siklus saat tahapnya dimulai (dipakai juga oleh cap status di luar film). */
export const AT = { type: 8, typed: 72, check: 74, press: 92, publish: 96 } as const;

export interface DeskProps {
  handle: string;
  /** Tiga posting, berurutan sesuai siklus. */
  posts: string[];
  /** Jam tayang tiap posting, mis. "12.12". */
  times: string[];
}

const C = {
  wallTop: "#0c1022",
  wallBottom: "#080a15",
  line: "#252a3a",
  lineStrong: "#343a4f",
  fg: "#eef0f8",
  muted: "#a0a6bd",
  faint: "#6f7690",
  accent: "#7b8aff",
  cyan: "#4fd8ff",
  success: "#3dd6a0",
  danger: "#ff6b81",
  screen: "#0b0d17",
};
const SANS = "var(--font-plus-jakarta), system-ui, sans-serif";
const MONO = "var(--font-jetbrains), ui-monospace, Consolas, monospace";
const DISPLAY = "var(--font-bricolage), var(--font-plus-jakarta), system-ui, sans-serif";
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const TAU = Math.PI * 2;
/** Lapisan sendiri untuk elemen yang bergerak: perubahan transform/opacity tidak memicu gambar ulang. */
const MOVE: React.CSSProperties = { willChange: "transform" };
const FADE: React.CSSProperties = { willChange: "opacity" };

/** Gelombang periodik yang pas dengan satu putaran (k = berapa kali per putaran), supaya perulangan mulus. */
const wave = (frame: number, k: number, phase = 0) => Math.sin(TAU * (k * (frame / DESK_DURATION) + phase));
const fmt = (n: number) => Math.round(n).toLocaleString("id-ID");

/** Siklus ke-c dimulai di frame c*CYCLE; waktu terbit posting k (boleh negatif = putaran sebelumnya). */
function pubTime(k: number, frame: number): number {
  const t = k * CYCLE + AT.publish;
  return t <= frame ? t : t - DESK_DURATION;
}

/* ------------------------------------------------------------------ ruangan (statis) */

const Room = memo(function Room() {
  return (
    <>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${C.wallTop}, ${C.wallBottom} 80%)` }} />
      {/* Cahaya monitor jatuh ke dinding dan meja */}
      <AbsoluteFill style={{ background: "radial-gradient(460px 360px at 290px 460px, rgba(123,138,255,0.22), transparent 70%)" }} />
      {/* Meja */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 694, height: 32, background: "linear-gradient(180deg, #2a3050, #1c2033)", borderTop: "1px solid #3a4166" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 726, bottom: 0, background: "linear-gradient(180deg, #121526, #0a0c16)" }} />
      <div style={{ position: "absolute", left: 60, width: 280, top: 760, height: 56, borderRadius: 10, border: "1px solid #1d2136" }} />
      <div style={{ position: "absolute", left: 420, width: 280, top: 760, height: 56, borderRadius: 10, border: "1px solid #1d2136" }} />
      {/* Kaki monitor */}
      <div style={{ position: "absolute", left: 268, width: 40, top: 646, height: 44, background: "linear-gradient(90deg, #232842, #31375a, #232842)" }} />
      <div style={{ position: "absolute", left: 206, width: 164, top: 686, height: 10, borderRadius: 8, background: "#2c3252" }} />
    </>
  );
});

const STARS = [
  [30, 34, 0.1],
  [74, 22, 0.4],
  [112, 52, 0.7],
  [150, 30, 0.25],
  [58, 70, 0.55],
  [196, 96, 0.85],
  [20, 98, 0.35],
];
/** Gedung: posisi x, lebar, tinggi. */
const BUILDINGS = [
  [0, 34, 58],
  [38, 30, 84],
  [72, 40, 46],
  [116, 26, 72],
  [146, 38, 54],
  [188, 42, 90],
];

/** Gedung dan jendelanya: berubah hanya tiap 45 frame (lampu menyala/padam bergiliran). */
const Skyline = memo(function Skyline({ bucket }: { bucket: number }) {
  return (
    <>
      {BUILDINGS.map(([x, w, h], b) => (
        <div key={b} style={{ position: "absolute", left: x, bottom: 0, width: w, height: h, background: "#0a0e24", borderTop: "1px solid #1b2147" }}>
          {Array.from({ length: Math.floor(h / 16) * 2 }, (_, i) => {
            const on = (bucket * 7 + b * 13 + i * 5) % 9 < 4;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 6 + (i % 2) * (w / 2 - 2),
                  top: 8 + Math.floor(i / 2) * 16,
                  width: 6,
                  height: 6,
                  borderRadius: 1,
                  background: on ? "#ffd27a" : "#1a2045",
                  boxShadow: on ? "0 0 6px rgba(255,210,122,0.7)" : "none",
                }}
              />
            );
          })}
        </div>
      ))}
    </>
  );
});

function NightWindow({ frame }: { frame: number }) {
  return (
    <div style={{ position: "absolute", left: 36, top: 40, width: 232, height: 176, borderRadius: 18, overflow: "hidden", border: "6px solid #262c47", background: "linear-gradient(180deg, #111a3f, #1d2152)" }}>
      {/* Pendar bulan: gradien tetap, hanya opacity-nya yang bernapas */}
      <div style={{ ...FADE, position: "absolute", left: 120, top: -12, width: 106, height: 106, borderRadius: 106, background: "radial-gradient(closest-side, rgba(243,240,216,0.5), transparent)", opacity: 0.75 + 0.25 * wave(frame, 3) }} />
      <div style={{ position: "absolute", left: 150, top: 18, width: 46, height: 46, borderRadius: 46, background: "#f3f0d8" }} />
      <div style={{ position: "absolute", left: 164, top: 14, width: 40, height: 40, borderRadius: 40, background: "#141c46" }} />
      {/* Bintang cukup kecil untuk digambar ulang; tidak diberi lapisan sendiri supaya jumlah lapisan tetap sedikit. */}
      {STARS.map(([x, y, ph], i) => (
        <div key={i} style={{ position: "absolute", left: x, top: y, width: 3, height: 3, borderRadius: 3, background: "#fff", opacity: 0.35 + 0.6 * Math.abs(wave(frame, 5 + i, ph)) }} />
      ))}
      <Skyline bucket={Math.floor(frame / 45)} />
    </div>
  );
}

const ClockFace = memo(function ClockFace() {
  return (
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} style={{ position: "absolute", left: 51, top: 4, width: 4, height: i % 3 === 0 ? 12 : 7, borderRadius: 2, background: i % 3 === 0 ? C.fg : C.faint, transformOrigin: "2px 49px", transform: `rotate(${i * 30}deg)` }} />
      ))}
    </>
  );
});

/** Jam dinding timelapse: jarum menit berputar cepat, menandakan waktu jalan terus selagi robot tidur. */
function WallClock({ frame }: { frame: number }) {
  const minute = (frame / DESK_DURATION) * 360 * 12;
  const hour = (frame / DESK_DURATION) * 360;
  return (
    <div style={{ position: "absolute", left: 584, top: 58, width: 116, height: 116, borderRadius: 116, background: "#12162a", border: "5px solid #2c3252", boxShadow: "0 10px 30px rgba(0,0,0,0.45)" }}>
      <ClockFace />
      <div style={{ ...MOVE, position: "absolute", left: 51, top: 26, width: 5, height: 28, borderRadius: 3, background: C.fg, transformOrigin: "2.5px 27px", transform: `rotate(${hour}deg)` }} />
      <div style={{ ...MOVE, position: "absolute", left: 52, top: 12, width: 3, height: 42, borderRadius: 2, background: C.cyan, transformOrigin: "1.5px 41px", transform: `rotate(${minute}deg)`, boxShadow: `0 0 8px ${C.cyan}` }} />
      <div style={{ position: "absolute", left: 47, top: 47, width: 12, height: 12, borderRadius: 12, background: C.accent }} />
    </div>
  );
}

/* ------------------------------------------------------------------ robot tidur */

const BodyShell = memo(function BodyShell() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, borderRadius: 34, background: "linear-gradient(160deg, #c3cbf2, #7f88c0)" }} />
      <div style={{ position: "absolute", left: 44, top: 22, width: 52, height: 22, borderRadius: 8, background: "#1a1f3a", border: "1px solid #3a4166" }}>
        <div style={{ position: "absolute", left: 20, top: 9, width: 24, height: 4, borderRadius: 2, background: "#3a4166" }} />
      </div>
    </>
  );
});

function RobotBody({ frame }: { frame: number }) {
  return (
    <div style={{ ...MOVE, position: "absolute", left: 588, top: 618, width: 140, height: 100, transform: `scale(${1 + wave(frame, 10) * 0.012})`, transformOrigin: "50% 100%" }}>
      <BodyShell />
      <div style={{ ...FADE, position: "absolute", left: 51, top: 30, width: 8, height: 8, borderRadius: 8, background: C.success, opacity: 0.4 + 0.6 * Math.abs(wave(frame, 6)) }} />
    </div>
  );
}

/** Wajah robot: hanya berubah saat mengintip (dua kali per siklus), jadi dibekukan di antaranya. */
const HeadFace = memo(function HeadFace({ peek }: { peek: boolean }) {
  const eye = { filter: `drop-shadow(0 0 4px ${C.cyan})` };
  return (
    <>
      {/* Antena terkulai */}
      <div style={{ position: "absolute", left: 92, top: -30, width: 4, height: 34, borderRadius: 2, background: "#9aa3d8", transform: "rotate(24deg)", transformOrigin: "50% 100%" }} />
      <div style={{ position: "absolute", left: 104, top: -40, width: 18, height: 18, borderRadius: 18, background: C.danger }} />
      {/* Kepala */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 38, background: "linear-gradient(150deg, #eef1ff, #a9b2e6 70%)", boxShadow: "inset -10px -12px 0 rgba(60,70,130,0.18), 0 14px 26px rgba(0,0,0,0.35)" }} />
      <div style={{ position: "absolute", left: -10, top: 44, width: 16, height: 34, borderRadius: 8, background: "#8c95cc" }} />
      <div style={{ position: "absolute", right: -10, top: 44, width: 16, height: 34, borderRadius: 8, background: "#8c95cc" }} />
      {/* Visor + mata */}
      <div style={{ position: "absolute", left: 20, top: 26, width: 122, height: 58, borderRadius: 22, background: "#0d1126", border: "2px solid #2b3260" }}>
        <svg width={122} height={58} viewBox="0 0 122 58" style={{ position: "absolute", left: -2, top: -2 }}>
          <path d="M28 30 Q38 39 48 30" stroke={C.cyan} strokeWidth={4} strokeLinecap="round" fill="none" style={eye} />
          {peek ? (
            <circle cx={84} cy={29} r={7} fill={C.cyan} style={eye} />
          ) : (
            <path d="M74 30 Q84 39 94 30" stroke={C.cyan} strokeWidth={4} strokeLinecap="round" fill="none" style={eye} />
          )}
        </svg>
      </div>
      <div style={{ position: "absolute", left: 24, top: 90, width: 20, height: 9, borderRadius: 9, background: "rgba(255,120,150,0.45)" }} />
      <div style={{ position: "absolute", left: 118, top: 90, width: 20, height: 9, borderRadius: 9, background: "rgba(255,120,150,0.45)" }} />
    </>
  );
});

function RobotHead({ frame }: { frame: number }) {
  const local = frame % CYCLE;
  // Sekali per siklus, tepat setelah posting terbit, robot mengintip sebentar lalu tidur lagi.
  const peek = local > AT.publish + 6 && local < AT.publish + 26;
  const bulb = interpolate(local, [AT.publish, AT.publish + 8, AT.publish + 30], [1, 1, 0], CLAMP);
  const glow = Math.min(1, 0.35 + 0.25 * Math.abs(wave(frame, 6)) + bulb * 0.6);
  return (
    <div style={{ ...MOVE, position: "absolute", left: 572, top: 548, width: 162, height: 122, transform: `rotate(-12deg) translateY(${(wave(frame, 10) * 2.2).toFixed(2)}px)`, transformOrigin: "60% 100%" }}>
      {/* Pendar lampu antena: gradien tetap, hanya opacity yang berubah */}
      <div style={{ ...FADE, position: "absolute", left: 83, top: -61, width: 60, height: 60, borderRadius: 60, background: "radial-gradient(closest-side, rgba(255,107,129,0.9), transparent)", opacity: glow }} />
      <HeadFace peek={peek} />
    </div>
  );
}

const RobotArms = memo(function RobotArms() {
  return (
    <>
      <div style={{ position: "absolute", left: 560, top: 664, width: 120, height: 34, borderRadius: 18, background: "linear-gradient(180deg, #d4daf8, #9aa3d8)", boxShadow: "0 6px 12px rgba(0,0,0,0.3)" }} />
      <div style={{ position: "absolute", left: 640, top: 670, width: 112, height: 32, borderRadius: 18, background: "linear-gradient(180deg, #c9d0f5, #8e97cf)", boxShadow: "0 6px 12px rgba(0,0,0,0.3)" }} />
      <div style={{ position: "absolute", left: 548, top: 668, width: 30, height: 28, borderRadius: 14, background: "#b8c0ee" }} />
    </>
  );
});

/** "Zzz" naik dari kepala robot, satu huruf tiap 45 frame (posisi & ukuran lewat transform). */
function Snore({ frame }: { frame: number }) {
  const PERIOD = 45;
  const LIFE = 90;
  const items = [];
  for (let n = 0; n < 3; n++) {
    const born = Math.floor(frame / PERIOD) * PERIOD - n * PERIOD;
    const age = frame - born;
    if (age < 0 || age > LIFE) continue;
    const t = age / LIFE;
    const x = t * 26 + Math.sin(t * 6) * 6;
    items.push(
      <div
        key={born}
        style={{
          position: "absolute",
          left: 704,
          top: 520,
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 44,
          lineHeight: 1,
          color: C.muted,
          transformOrigin: "0 100%",
          willChange: "transform, opacity",
          transform: `translate(${x.toFixed(1)}px, ${(-t * 150).toFixed(1)}px) scale(${(0.5 + t * 0.5).toFixed(3)})`,
          opacity: interpolate(t, [0, 0.15, 0.7, 1], [0, 0.9, 0.7, 0]),
        }}
      >
        z
      </div>
    );
  }
  return <>{items}</>;
}

/* ------------------------------------------------------------------ ponsel di meja */

const PhoneBody = memo(function PhoneBody() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, borderRadius: 10, background: "#1b1f33", border: "2px solid #3a4166" }} />
      <div style={{ position: "absolute", left: 4, top: 5, right: 4, bottom: 5, borderRadius: 6, background: "#080a14" }} />
      <div style={{ position: "absolute", left: -6, right: -6, bottom: -6, height: 12, borderRadius: 4, background: "#2c3252" }} />
    </>
  );
});

const PhoneLit = memo(function PhoneLit() {
  return (
    <>
      <div style={{ position: "absolute", left: 4, top: 5, right: 4, bottom: 5, borderRadius: 6, background: "linear-gradient(180deg, #23295a, #12152c)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <Heart size={13} color={C.danger} fill={C.danger} />
        <div style={{ width: 22, height: 3, borderRadius: 2, background: C.fg, opacity: 0.8 }} />
        <div style={{ width: 16, height: 3, borderRadius: 2, background: C.faint }} />
      </div>
      <div style={{ position: "absolute", left: -20, top: -20, right: -20, bottom: -10, borderRadius: 30, background: "radial-gradient(closest-side, rgba(123,138,255,0.45), transparent)" }} />
    </>
  );
});

function Phone({ frame }: { frame: number }) {
  const local = frame % CYCLE;
  const lit = interpolate(local, [AT.publish, AT.publish + 4, AT.publish + 48, AT.publish + 54], [0, 1, 1, 0], CLAMP);
  const shake = local >= AT.publish && local < AT.publish + 12 ? Math.sin(local * 2.4) * 2.5 : 0;
  return (
    // Berdiri di depan bingkai bawah monitor, tidak menutupi layarnya (layar berakhir di y=636).
    <div style={{ ...MOVE, position: "absolute", left: 398, top: 632, width: 44, height: 62, transform: `translateX(${shake.toFixed(2)}px) rotate(-6deg)` }}>
      <PhoneBody />
      <div style={{ ...FADE, position: "absolute", inset: 0, opacity: lit }}>
        <PhoneLit />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ monitor: Threads berjalan sendiri */

const SCREEN = { x: 42, y: 264, w: 492, h: 372 };
const POST_H = 112;
const LIKES = [184, 96, 241];
const REPLIES = [23, 41, 17];

function Avatar({ letter, size = 34 }: { letter: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size, background: C.fg, color: C.screen, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, fontWeight: 800, fontSize: size * 0.42, flexShrink: 0, textTransform: "uppercase" }}>
      {letter}
    </div>
  );
}

function ThreadsLogo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={C.fg}>
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z" />
    </svg>
  );
}

/**
 * Satu posting di linimasa. Dibekukan dengan memo; `age` sudah dibulatkan oleh pemanggil (tiap frame saat
 * baru terbit, lalu tiap 4 frame), jadi angka suka naik halus tanpa merender ulang posting tiap frame.
 */
const FeedPost = memo(function FeedPost({ handle, text, time, age, k }: { handle: string; text: string; time: string; age: number; k: number }) {
  const ease = 1 - Math.exp(-Math.max(0, age) / 80);
  const likes = LIKES[k] * ease;
  const replies = REPLIES[k] * ease;
  const liked = age > 14;
  const pop = 1 + 0.35 * Math.sin(Math.PI * interpolate(age, [14, 24], [0, 1], CLAMP));
  return (
    <div style={{ height: POST_H, padding: "14px 18px", display: "flex", gap: 12, borderBottom: `1px solid ${C.line}` }}>
      <Avatar letter={handle[1] ?? "b"} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: SANS, fontSize: 15 }}>
          <span style={{ fontWeight: 800, color: C.fg }}>{handle.slice(1)}</span>
          <span style={{ color: C.faint }}>{age < 70 ? "baru saja" : time}</span>
        </div>
        <div style={{ marginTop: 3, fontFamily: SANS, fontSize: 15, lineHeight: 1.38, color: C.fg, height: 42, overflow: "hidden" }}>{text}</div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 18, fontFamily: SANS, fontSize: 13, fontWeight: 700, color: C.muted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "flex", transform: `scale(${pop.toFixed(3)})` }}>
              <Heart size={16} color={liked ? C.danger : C.muted} fill={liked ? C.danger : "none"} />
            </span>
            {fmt(likes)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <MessageCircle size={16} />
            {fmt(replies)}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Repeat2 size={16} />
            {fmt(replies * 0.4)}
          </span>
        </div>
      </div>
    </div>
  );
});

/** Bilah atas layar. `dot` = opacity titik hijau AUTOPILOT (berkedip di lapisannya sendiri). */
function ScreenTopBar({ handle, dot }: { handle: string; dot: number }) {
  return (
    <div style={{ height: 46, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 14, fontWeight: 800, color: C.fg, maxWidth: 170, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{handle}</span>
      <ThreadsLogo />
      <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "rgba(61,214,160,0.14)", color: C.success, fontFamily: MONO, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>
        <span style={{ ...FADE, width: 7, height: 7, borderRadius: 7, background: C.success, opacity: dot }} />
        AUTOPILOT
      </span>
    </div>
  );
}

/** Kolom tulis: berubah hanya saat jumlah huruf/tahap berubah, jadi dibekukan di antaranya. */
const Composer = memo(function Composer({ handle, text, typing, checking, pressed, caretOn }: { handle: string; text: string; typing: boolean; checking: boolean; pressed: boolean; caretOn: boolean }) {
  return (
    <div style={{ height: 98, padding: "12px 16px", display: "flex", gap: 12, borderBottom: `1px solid ${C.line}`, background: "rgba(123,138,255,0.05)" }}>
      <Avatar letter={handle[1] ?? "b"} />
      <div style={{ minWidth: 0, flex: 1, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 11, fontWeight: 700, color: checking ? C.success : C.accent }}>
          {checking ? <BadgeCheck size={13} /> : <Sparkles size={13} />}
          {checking ? "lolos cek aturan · skor 0,87" : typing || text ? "AI menulis…" : "menunggu jam tayang"}
        </div>
        <div style={{ marginTop: 4, fontSize: 14.5, lineHeight: 1.36, color: text ? C.fg : C.faint, height: 40, overflow: "hidden", paddingRight: 86 }}>
          {text || "Mulai utas baru…"}
          {text && caretOn ? <span style={{ display: "inline-block", width: 2, height: 16, marginLeft: 2, verticalAlign: "-3px", background: C.accent }} /> : null}
        </div>
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            height: 30,
            padding: "0 14px",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            fontSize: 13,
            fontWeight: 800,
            background: pressed ? C.accent : text ? C.fg : "#2a2f45",
            color: text || pressed ? C.screen : C.faint,
            transform: `scale(${pressed ? 0.9 : 1})`,
          }}
        >
          Posting
        </div>
      </div>
    </div>
  );
});

function Screen({ frame, handle, posts, times }: { frame: number } & DeskProps) {
  const cycle = Math.floor(frame / CYCLE);
  const local = frame - cycle * CYCLE;
  const k = cycle % 3;
  const chars = Array.from(posts[k] ?? "");
  const typedN = local >= AT.publish ? 0 : Math.floor(interpolate(local, [AT.type, AT.typed], [0, chars.length], CLAMP));
  const typing = local >= AT.type && local < AT.typed;
  const checking = local >= AT.check && local < AT.publish;
  const pressed = local >= AT.press && local < AT.press + 6;
  const caretOn = typing || Math.floor(frame / 9) % 2 === 0;

  // Posting terbaru yang sudah terbit (bisa dari siklus sebelumnya) + transisi masuknya.
  const newest = local >= AT.publish ? k : (k + 2) % 3;
  const newestAge = frame - pubTime(newest, frame);
  const p = spring({ frame: newestAge, fps: BASE_FPS, config: { damping: 18, stiffness: 120 } });
  // pubTime selalu kejadian terakhir yang sudah lewat, jadi umur posting lama otomatis lebih besar.
  const feed = [0, 1, 2].map((j) => {
    const idx = (newest - j + 3) % 3;
    const age = frame - pubTime(idx, frame);
    return { idx, age: age < 40 ? age : age - (age % 4) };
  });

  // Kursor "hantu": melayang di dekat draf, lalu menuju tombol Posting dan menekannya.
  const toBtn = interpolate(local, [AT.check, AT.press - 2], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const away = interpolate(local, [AT.publish + 6, AT.publish + 30], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.cubic) });
  const idleX = 250 + 30 * wave(frame, 9);
  const idleY = 112 + 10 * wave(frame, 12, 0.3);
  const cx = interpolate(away, [0, 1], [interpolate(toBtn, [0, 1], [idleX, 438]), idleX]);
  const cy = interpolate(away, [0, 1], [interpolate(toBtn, [0, 1], [idleY, 124]), idleY]);
  const ripple = interpolate(local, [AT.press, AT.press + 14], [0, 1], CLAMP);

  return (
    <div style={{ position: "absolute", left: SCREEN.x, top: SCREEN.y, width: SCREEN.w, height: SCREEN.h, borderRadius: 10, overflow: "hidden", background: C.screen, fontFamily: SANS }}>
      <ScreenTopBar handle={handle} dot={0.45 + 0.55 * Math.abs(wave(frame, 15))} />

      <Composer handle={handle} text={typedN ? chars.slice(0, typedN).join("") : ""} typing={typing} checking={checking} pressed={pressed} caretOn={caretOn} />

      {/* Linimasa: posting baru masuk dari atas, yang lama turun (transform, bukan top) */}
      <div style={{ position: "relative", height: SCREEN.h - 144 }}>
        {feed.map(({ idx, age }, j) => {
          const y = j === 0 ? 0 : POST_H * (j - 1 + p);
          const fresh = j === 0 && newestAge < 60;
          return (
            <div
              key={idx}
              style={{
                ...MOVE,
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                opacity: j === 0 ? p : 1,
                transform: j === 0 ? `scale(${(0.96 + 0.04 * p).toFixed(3)})` : `translateY(${y.toFixed(1)}px)`,
                background: fresh ? `rgba(123,138,255,${(0.12 * (1 - newestAge / 60)).toFixed(3)})` : undefined,
              }}
            >
              <FeedPost handle={handle} text={posts[idx] ?? ""} time={times[idx] ?? ""} age={age} k={idx} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 40, background: `linear-gradient(transparent, ${C.screen})` }} />
      </div>

      {/* Kursor hantu */}
      <div style={{ ...MOVE, position: "absolute", left: 0, top: 0, pointerEvents: "none", transform: `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)` }}>
        {ripple > 0 && ripple < 1 ? (
          <div style={{ position: "absolute", left: -16, top: -16, width: 32, height: 32, borderRadius: 32, border: `2px solid ${C.accent}`, opacity: 1 - ripple, transform: `scale(${(0.4 + ripple * 1.2).toFixed(3)})` }} />
        ) : null}
        <Cursor />
      </div>
    </div>
  );
}

const Cursor = memo(function Cursor() {
  return (
    <>
      <svg width={22} height={26} viewBox="0 0 22 26" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>
        <path d="M2 2 L2 20 L7 15 L11 24 L14 22.5 L10 14 L17 14 Z" fill="#fff" stroke="#0b0d17" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
      <span style={{ position: "absolute", left: 18, top: 18, padding: "2px 6px", borderRadius: 6, background: C.accent, color: C.screen, fontFamily: MONO, fontSize: 10, fontWeight: 800 }}>AI</span>
    </>
  );
});

const MonitorBezel = memo(function MonitorBezel() {
  return (
    <>
      <div style={{ position: "absolute", left: 28, top: 250, width: 520, height: 400, borderRadius: 24, background: "linear-gradient(160deg, #262b45, #171a2c)", border: "1px solid #3a4166", boxShadow: "0 30px 60px rgba(0,0,0,0.55), 0 0 80px rgba(123,138,255,0.18)" }} />
      <div style={{ position: "absolute", left: 280, top: 640, width: 16, height: 4, borderRadius: 2, background: C.success, opacity: 0.6 }} />
    </>
  );
});

/* ------------------------------------------------------------------ notifikasi beterbangan */

const NOTES = [
  [
    { Icon: Heart, text: "+38 suka", color: C.danger },
    { Icon: MessageCircle, text: "rina.ayu membalas", color: C.accent },
    { Icon: Eye, text: "+1,2rb views", color: C.cyan },
  ],
  [
    { Icon: MessageCircle, text: "3 balasan baru", color: C.accent },
    { Icon: Heart, text: "+52 suka", color: C.danger },
    { Icon: Repeat2, text: "diposting ulang", color: C.success },
  ],
  [
    { Icon: Eye, text: "+3,4rb views", color: C.cyan },
    { Icon: Heart, text: "+71 suka", color: C.danger },
    { Icon: MessageCircle, text: "dimas.p membalas", color: C.accent },
  ],
];

const NotePill = memo(function NotePill({ note }: { note: (typeof NOTES)[number][number] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 999, background: C.fg, color: C.screen, fontFamily: SANS, fontSize: 14, fontWeight: 800, whiteSpace: "nowrap", boxShadow: "0 10px 24px rgba(0,0,0,0.45)" }}>
      <note.Icon size={15} color={note.color} fill={note.Icon === Heart ? note.color : "none"} />
      {note.text}
    </div>
  );
});

function Notifications({ frame }: { frame: number }) {
  const cycle = Math.floor(frame / CYCLE);
  const local = frame - cycle * CYCLE;
  return (
    <>
      {NOTES[cycle % 3].map((n, i) => {
        const at = AT.publish + 10 + i * 14;
        const t = interpolate(local, [at, at + 44], [0, 1], CLAMP);
        if (t <= 0 || t >= 1) return null;
        const pop = spring({ frame: local - at, fps: BASE_FPS, config: { damping: 12 } });
        return (
          <div
            key={`${cycle}-${i}`}
            style={{
              position: "absolute",
              left: 330 + i * 54,
              top: 258,
              willChange: "transform, opacity",
              opacity: interpolate(t, [0, 0.12, 0.75, 1], [0, 1, 1, 0]),
              transform: `translateY(${(-t * 76).toFixed(1)}px) scale(${(0.6 + pop * 0.4).toFixed(3)})`,
            }}
          >
            <NotePill note={n} />
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ komposisi */

/** Label kecil: menegaskan semuanya berjalan tanpa disentuh. `dot` = opacity titik hijaunya. */
function Label({ dot }: { dot: number }) {
  return (
    <>
      <div style={{ position: "absolute", left: 300, top: 104, display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 12, background: "rgba(20,23,34,0.85)", border: `1px solid ${C.lineStrong}`, color: C.muted, fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>
        <span style={{ ...FADE, width: 8, height: 8, borderRadius: 8, background: C.success, boxShadow: `0 0 10px ${C.success}`, opacity: dot }} />
        pemilik lagi tidur
      </div>
      <div style={{ position: "absolute", left: 300, top: 150, color: C.faint, fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>THREADS TETAP JALAN</div>
    </>
  );
}

export function AutopilotDesk({ handle, posts, times }: DeskProps) {
  const { fps } = useVideoConfig();
  const frame = toBaseFrame(useCurrentFrame(), fps);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Room />
      <NightWindow frame={frame} />
      <WallClock frame={frame} />
      <RobotBody frame={frame} />
      {/* Meja menutupi badan robot bagian bawah */}
      <div style={{ position: "absolute", left: 560, right: 0, top: 694, height: 32, background: "linear-gradient(180deg, #2a3050, #1c2033)", borderTop: "1px solid #3a4166" }} />
      <MonitorBezel />
      <Screen frame={frame} handle={handle} posts={posts} times={times} />
      <Phone frame={frame} />
      <RobotArms />
      <RobotHead frame={frame} />
      <Snore frame={frame} />
      <Notifications frame={frame} />
      <Label dot={0.5 + 0.5 * Math.abs(wave(frame, 15))} />
    </AbsoluteFill>
  );
}
