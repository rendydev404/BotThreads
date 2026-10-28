import React, { useMemo } from "react";
import { Easing, interpolate, spring, useCurrentFrame } from "remotion";
import { useT } from "@/components/i18n/lang-provider";
import type { TFunction } from "@/lib/i18n/core";
import { DESC, DESC_CLASS, H1_CLASS, HEADLINE_LINES, SUB, SUB_CLASS } from "../hero-copy-data";

/**
 * Animasi intro judul + deskripsi bagian pembuka. Komposisi ini dirender dengan ukuran persis kotak teks
 * aslinya (skala 1) dan memakai kelas CSS yang sama, jadi tata letaknya identik dengan HTML di bawahnya.
 * Setelah selesai, pembungkusnya (hero-copy.tsx) melepas Player dan teks asli tampil kembali.
 *
 *   baris 1  naik dari bawah sambil menajam (blur -> jelas)
 *   baris 2  terbuka dari kiri, disapu garis cahaya di tepinya
 *   baris 3  memantul masuk, lalu kursor berkedip dua kali
 *   deskripsi  muncul kata demi kata; kata kunci menyala ke warna aksen
 */

export const HEADLINE_FPS = 30;
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const LINE_AT = [0, 8, 18];
const DESC_AT = 30;
const WORD_GAP = 1.1;

/** Kata-kata deskripsi; tanda baca yang menempel ke kata sebelumnya digabung supaya pemenggalan baris sama. */
type Token = { parts: { text: string; key: boolean }[] };
function tokenize(t: TFunction): { tokens: (Token | string)[]; words: number } {
  const out: (Token | string)[] = [];
  let words = 0;
  for (const seg of DESC) {
    // Teks diterjemahkan per potongan (kunci sama dengan HTML aslinya), jadi tata letaknya tetap identik.
    for (const piece of t(seg.text).split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        out.push(" ");
        continue;
      }
      const prev = out[out.length - 1];
      if (prev && typeof prev !== "string") prev.parts.push({ text: piece, key: !!seg.key });
      else {
        out.push({ parts: [{ text: piece, key: !!seg.key }] });
        words++;
      }
    }
  }
  return { tokens: out, words };
}

/**
 * Kata-kata deskripsi dalam bahasa aktif + kapan baris penutup masuk dan panjang total intro (frame).
 * Panjang intro ikut jumlah kata, jadi dipakai juga oleh Player (headline-player.tsx).
 */
export function useHeadlineTiming() {
  const t = useT();
  return useMemo(() => {
    const { tokens, words } = tokenize(t);
    const subAt = Math.ceil(DESC_AT + words * WORD_GAP + 6);
    return { t, tokens, subAt, duration: subAt + 34 };
  }, [t]);
}

export function HeadlineFilm() {
  const frame = useCurrentFrame();
  const { t, tokens, subAt } = useHeadlineTiming();
  const fps = HEADLINE_FPS;

  // Baris 1: naik + menajam.
  const p1 = spring({ frame: frame - LINE_AT[0], fps, config: { damping: 200 }, durationInFrames: 20 });
  // Baris 2: dibuka dari kiri dengan garis cahaya.
  const reveal = interpolate(frame, [LINE_AT[1], LINE_AT[1] + 22], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  // Baris 3: memantul.
  const p3 = spring({ frame: frame - LINE_AT[2], fps, config: { damping: 13, stiffness: 140 } });
  const caretOn = frame > LINE_AT[2] + 14 && frame < LINE_AT[2] + 44 && Math.floor((frame - LINE_AT[2]) / 7) % 2 === 0;

  let w = 0;
  return (
    // Aliran blok biasa (bukan AbsoluteFill yang flex) supaya jarak antarparagraf sama dengan HTML aslinya.
    <div style={{ position: "absolute", inset: 0 }}>
      <h1 className={H1_CLASS} style={{ marginTop: 0 }}>
        <span className="block w-fit" style={{ opacity: p1, transform: `translateY(${((1 - p1) * 0.45).toFixed(3)}em)`, filter: p1 < 0.99 ? `blur(${((1 - p1) * 10).toFixed(1)}px)` : undefined }}>
          {t(HEADLINE_LINES[0].text)}
        </span>
        <span className="block w-fit relative">
          <span className={`block ${HEADLINE_LINES[1].className}`} style={{ clipPath: reveal < 1 ? `inset(-0.15em ${((1 - reveal) * 100).toFixed(2)}% -0.25em 0)` : undefined }}>
            {t(HEADLINE_LINES[1].text)}
          </span>
          {reveal > 0 && reveal < 1 ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "0.05em",
                bottom: "-0.05em",
                left: `${(reveal * 100).toFixed(2)}%`,
                width: "0.08em",
                borderRadius: 4,
                background: "linear-gradient(180deg, var(--c-accent), #4fd8ff)",
                boxShadow: "0 0 24px 4px rgba(79,216,255,0.55)",
              }}
            />
          ) : null}
        </span>
        <span className="block w-fit relative" style={{ opacity: Math.min(1, p3 * 1.4), transform: `translateY(${((1 - p3) * 0.35).toFixed(3)}em) scale(${(0.94 + 0.06 * p3).toFixed(3)})`, transformOrigin: "0% 100%" }}>
          {t(HEADLINE_LINES[2].text)}
          {caretOn ? <span aria-hidden="true" style={{ position: "absolute", right: "-0.12em", top: "0.1em", bottom: "0.02em", width: "0.07em", borderRadius: 2, background: "var(--c-accent)" }} /> : null}
        </span>
      </h1>

      <p className={DESC_CLASS}>
        {tokens.map((tok, i) => {
          if (typeof tok === "string") return tok;
          const at = DESC_AT + w * WORD_GAP;
          w++;
          const p = spring({ frame: frame - at, fps, config: { damping: 200 }, durationInFrames: 12 });
          const glow = interpolate(frame, [at + 6, at + 16], [0, 1], CLAMP);
          return (
            <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${((1 - p) * 10).toFixed(1)}px)` }}>
              {tok.parts.map((part, j) =>
                part.key ? (
                  <strong key={j} style={{ fontWeight: 800, color: glow >= 1 ? "var(--c-accent)" : `color-mix(in srgb, var(--c-accent) ${(glow * 100).toFixed(0)}%, var(--c-fg))` }}>
                    {part.text}
                  </strong>
                ) : (
                  <React.Fragment key={j}>{part.text}</React.Fragment>
                )
              )}
            </span>
          );
        })}
      </p>

      <SubLine frame={frame} at={subAt} t={t} />
    </div>
  );
}

function SubLine({ frame, at, t }: { frame: number; at: number; t: TFunction }) {
  const p = spring({ frame: frame - at, fps: HEADLINE_FPS, config: { damping: 14, stiffness: 150 } });
  return (
    <p className={SUB_CLASS} style={{ opacity: Math.min(1, p * 1.3), transform: `translateY(${((1 - p) * 12).toFixed(1)}px)` }}>
      {t(SUB.lead)}
      <span className="lp-gradient-text">{t(SUB.accent)}</span>
    </p>
  );
}
