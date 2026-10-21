"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

/**
 * Maskot BotThreads (robot yang sama dengan film hero di landing page), sebagai SVG ringan untuk tur.
 * Semua gerak memakai animasi CSS transform/opacity (lapisan GPU, tanpa loop JS per frame) dan berhenti
 * bila pengguna memilih gerak dikurangi. Ekspresi diganti lewat `mood`.
 */
export type MascotMood = "sleep" | "wake" | "talk" | "point" | "cheer" | "poke";

const CSS = `
@keyframes btm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes btm-breath{0%,100%{transform:rotate(-12deg) translateY(0)}50%{transform:rotate(-12deg) translateY(2px)}}
@keyframes btm-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes btm-bulb{0%,100%{opacity:.35}50%{opacity:.9}}
@keyframes btm-z{0%{opacity:0;transform:translate(0,0) scale(.5)}20%{opacity:.9}100%{opacity:0;transform:translate(16px,-46px) scale(1.1)}}
@keyframes btm-wake{0%{transform:rotate(-12deg) translateY(2px)}45%{transform:rotate(4deg) translateY(-10px) scaleY(1.05)}100%{transform:rotate(0) translateY(0)}}
@keyframes btm-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-14px)}55%{transform:translateY(0)}70%{transform:translateY(-5px)}}
@keyframes btm-wave{0%,100%{transform:rotate(-150deg)}50%{transform:rotate(-115deg)}}
@keyframes btm-point{0%,100%{transform:rotate(-28deg) translateX(0)}50%{transform:rotate(-20deg) translateX(4px)}}
@keyframes btm-poke{0%,100%{transform:scale(1,1)}25%{transform:scale(1.1,.88)}55%{transform:scale(.94,1.08)}80%{transform:scale(1.03,.97)}}
@keyframes btm-spark{0%{opacity:0;transform:scale(.3) rotate(0)}40%{opacity:1}100%{opacity:0;transform:scale(1.2) rotate(90deg)}}
.btm *{transform-box:fill-box}
.btm-float{animation:btm-float 3.2s ease-in-out infinite}
.btm-head{transform-origin:50% 100%;transition:transform .4s}
.btm-sleep .btm-head{animation:btm-breath 3.6s ease-in-out infinite}
.btm-wake .btm-head{animation:btm-wake .7s cubic-bezier(.22,1,.36,1) both}
.btm-cheer .btm-body{animation:btm-bounce 1s ease-in-out infinite}
.btm-poke .btm-body{animation:btm-poke .5s ease-out both;transform-origin:50% 100%}
.btm-eyes{transform-origin:50% 50%;animation:btm-blink 4.2s infinite}
.btm-bulb{animation:btm-bulb 2.4s ease-in-out infinite}
.btm-z{animation:btm-z 2.7s ease-out infinite;opacity:0}
.btm-arm-r{transform-origin:0% 50%;transform:rotate(35deg);transition:transform .45s cubic-bezier(.22,1,.36,1)}
.btm-talk .btm-arm-r,.btm-wake .btm-arm-r{animation:btm-wave 1.1s ease-in-out 2}
.btm-point .btm-arm-r{animation:btm-point 1.4s ease-in-out infinite}
.btm-cheer .btm-arm-r{animation:btm-wave .6s ease-in-out infinite}
.btm-spark{opacity:0;animation:btm-spark 1.4s ease-out infinite}
@media (prefers-reduced-motion:reduce){.btm *,.btm{animation:none!important;transition:none!important}}
`;

const CYAN = "#4fd8ff";
const EYE = { filter: `drop-shadow(0 0 3px ${CYAN})` };

export const Mascot = memo(function Mascot({
  mood,
  size = 112,
  flip = false,
  className,
  onClick,
  label = "Maskot BotThreads",
}: {
  mood: MascotMood;
  size?: number;
  /** Cermin horizontal (menunjuk ke kiri). */
  flip?: boolean;
  className?: string;
  onClick?: () => void;
  label?: string;
}) {
  const sleeping = mood === "sleep";
  const happy = mood === "cheer" || mood === "poke";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? label : undefined}
      aria-hidden={onClick ? undefined : true}
      className={cn("btm shrink-0 select-none", `btm-${mood}`, onClick && "cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-accent", className)}
      style={{ width: size, height: size * 1.1, transform: flip ? "scaleX(-1)" : undefined }}
    >
      <style href="bt-mascot" precedence="default">
        {CSS}
      </style>
      <svg viewBox="0 0 200 220" width="100%" height="100%" className={sleeping ? undefined : "btm-float"} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="btm-head" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#eef1ff" />
            <stop offset=".7" stopColor="#a9b2e6" />
          </linearGradient>
          <linearGradient id="btm-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c3cbf2" />
            <stop offset="1" stopColor="#7f88c0" />
          </linearGradient>
          <radialGradient id="btm-glow">
            <stop offset="0" stopColor="#ff6b81" stopOpacity=".9" />
            <stop offset="1" stopColor="#ff6b81" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* bayangan */}
        <ellipse cx="100" cy="212" rx="52" ry="7" fill="#000" opacity=".22" />

        <g className="btm-body">
          {/* tangan kanan (melambai / menunjuk) */}
          <g transform="translate(140 166)">
            <g className="btm-arm-r">
              <rect x="0" y="-8" width="44" height="16" rx="8" fill="#b8c0ee" />
              <circle cx="44" cy="0" r="10" fill="#d4daf8" />
            </g>
          </g>
          {/* badan */}
          <rect x="58" y="150" width="84" height="56" rx="22" fill="url(#btm-body)" />
          <rect x="80" y="162" width="40" height="14" rx="5" fill="#1a1f3a" stroke="#3a4166" />
          <circle cx="100" cy="190" r="4.5" fill="#3dd6a0" className="btm-bulb" />
          {/* tangan kiri */}
          <rect x="40" y="158" width="18" height="36" rx="9" fill="#9aa3d8" />

          {/* kepala */}
          <g className="btm-head">
            <circle cx="104" cy="12" r="22" fill="url(#btm-glow)" className="btm-bulb" />
            <rect x="98" y="16" width="5" height="28" rx="2.5" fill="#9aa3d8" transform={sleeping ? "rotate(24 100 44)" : undefined} />
            <circle cx={sleeping ? 110 : 100} cy={sleeping ? 18 : 14} r="9" fill="#ff6b81" />
            <rect x="30" y="42" width="140" height="104" rx="36" fill="url(#btm-head)" />
            <rect x="21" y="78" width="14" height="32" rx="7" fill="#8c95cc" />
            <rect x="165" y="78" width="14" height="32" rx="7" fill="#8c95cc" />
            <rect x="46" y="64" width="108" height="52" rx="20" fill="#0d1126" stroke="#2b3260" strokeWidth="2" />
            {sleeping ? (
              <g stroke={CYAN} strokeWidth="4" strokeLinecap="round" fill="none" style={EYE}>
                <path d="M66 90 Q76 99 86 90" />
                <path d="M114 90 Q124 99 134 90" />
              </g>
            ) : happy ? (
              <g stroke={CYAN} strokeWidth="4" strokeLinecap="round" fill="none" style={EYE}>
                <path d="M66 95 Q76 82 86 95" />
                <path d="M114 95 Q124 82 134 95" />
              </g>
            ) : (
              <g className="btm-eyes" fill={CYAN} style={EYE}>
                <circle cx="76" cy="90" r="8" />
                <circle cx="124" cy="90" r="8" />
              </g>
            )}
            <ellipse cx="52" cy="128" rx="10" ry="4.5" fill="rgba(255,120,150,.45)" />
            <ellipse cx="148" cy="128" rx="10" ry="4.5" fill="rgba(255,120,150,.45)" />
          </g>
        </g>

        {sleeping &&
          [0, 0.9, 1.8].map((d, i) => (
            <text
              key={i}
              x={150 + i * 6}
              y={52 - i * 4}
              className="btm-z"
              style={{ animationDelay: `${d}s`, font: "800 22px var(--font-bricolage), system-ui, sans-serif" }}
              fill="#a0a6bd"
            >
              z
            </text>
          ))}
        {mood === "cheer" &&
          [
            [30, 40, 0],
            [176, 30, 0.4],
            [184, 120, 0.8],
            [14, 120, 1.1],
          ].map(([x, y, d], i) => (
            <path
              key={i}
              d={`M${x} ${y - 8} L${x + 2.5} ${y - 2.5} L${x + 8} ${y} L${x + 2.5} ${y + 2.5} L${x} ${y + 8} L${x - 2.5} ${y + 2.5} L${x - 8} ${y} L${x - 2.5} ${y - 2.5}Z`}
              fill={i % 2 ? "#7b8aff" : "#ffd166"}
              className="btm-spark"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
      </svg>
    </Tag>
  );
});
