"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { heroStore, useHero } from "../hero-store";
import { jitter, pad, personaFor, pickHours } from "../personas";
import { AT, AutopilotDesk, BASE_FPS, CYCLE, DESK_H, DESK_W, deskFrames, toBaseFrame } from "./autopilot-desk";

/** Frame diam (frame dasar) untuk pengguna yang meminta gerakan dikurangi: posting baru saja terbit. */
const STILL_BASE_FRAME = AT.publish + 40;

/**
 * fps Player menurut perangkat. Desktop 30 fps; ponsel dan perangkat lemah 20 fps (sepertiga lebih
 * hemat CPU/baterai, dan 20 fps pas dengan layar 60 Hz sehingga tetap mulus). Kecepatan gerak sama.
 */
function pickFps(): number {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const touch = window.matchMedia("(pointer: coarse)").matches;
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData === true;
  return touch || weak ? 20 : BASE_FPS;
}

/**
 * Remotion Player untuk animasi robot di bagian pembuka. Isi monitornya mengikuti bisnis yang diketik
 * pengunjung (lewat hero-store). Hanya berputar selama terlihat dan tab aktif; tahap yang sedang
 * tampil dikabarkan ke cap status di atas kartu (store hanya berubah tiga kali per siklus).
 */
export default function DeskPlayer() {
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const key = useHero((s) => s.key);
  const custom = useHero((s) => s.custom);
  // Komponen ini hanya dirender di browser (dimuat tanpa SSR), jadi aman membaca navigator di sini.
  const [fps] = useState(pickFps);
  const stillFrame = Math.round((STILL_BASE_FRAME * fps) / BASE_FPS);

  const inputProps = useMemo(() => {
    const persona = personaFor(key, custom);
    const hours = pickHours(persona.hours, 3);
    return {
      handle: persona.handle,
      posts: persona.posts.slice(0, 3).map((p) => p.text),
      times: hours.map((h, i) => `${pad(h)}.${pad(jitter(h, i))}`),
    };
  }, [key, custom]);

  // Efek ini dijalankan ulang tiap bisnis berganti, jadi animasi mulai lagi dari frame 0 dan posting
  // pertama untuk bisnis itu langsung terlihat diketik.
  useEffect(() => {
    const player = ref.current;
    const el = box.current;
    if (!player || !el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const total = deskFrames(fps);

    // Kabarkan tahap yang tampil ke cap status (store hanya berubah tiga kali per siklus).
    const report = (frame: number) => {
      const base = toBaseFrame(frame, fps);
      const local = base % CYCLE;
      const k = Math.floor(base / CYCLE) % 3;
      heroStore.set({
        phase: local < AT.check ? "Menulis" : local < AT.publish ? "Diperiksa" : "Terbit",
        time: inputProps.times[k] ?? "",
        slots: 3,
      });
    };

    if (reduced) {
      player.seekTo(stillFrame);
      report(stillFrame);
      return;
    }

    // Frame dimajukan sendiri dengan timer sesuai fps, bukan lewat player.play(): pemutar bawaan
    // berdetak tiap requestAnimationFrame (60x/detik) sehingga browser menyusun ulang halaman 60x/detik,
    // padahal gambarnya hanya berubah 20-30x/detik. Dengan timer, kerja browser ikut turun 2-3x.
    let frame = 0;
    let id = 0;
    let onScreen = true;
    const tick = () => {
      frame = (frame + 1) % total;
      player.seekTo(frame);
      report(frame);
    };
    const sync = () => {
      const run = onScreen && document.visibilityState === "visible";
      if (run && !id) id = window.setInterval(tick, 1000 / fps);
      if (!run && id) {
        clearInterval(id);
        id = 0;
      }
    };
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    player.seekTo(0);
    report(0);
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      clearInterval(id);
    };
  }, [inputProps, fps, stillFrame]);

  return (
    <div ref={box} className="w-full h-full">
      <Player
        ref={ref}
        component={AutopilotDesk}
        inputProps={inputProps}
        durationInFrames={deskFrames(fps)}
        fps={fps}
        compositionWidth={DESK_W}
        compositionHeight={DESK_H}
        style={{ width: "100%", height: "100%" }}
        loop
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        initiallyMuted
        acknowledgeRemotionLicense
      />
    </div>
  );
}
