"use client";

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Volume2, VolumeX } from "lucide-react";
import { AutopilotFilm, FILM_DURATION, FILM_FPS, FILM_HEIGHT, FILM_WIDTH } from "./autopilot-film";

/**
 * Remotion Player untuk film autopilot. Diputar otomatis dan berulang, tetapi hanya selama terlihat
 * di layar supaya tidak memakan CPU saat pengunjung sudah menggulir ke bagian lain.
 *
 * Suara: browser hanya mengizinkan audio setelah pengunjung berinteraksi dengan halaman (klik, tap,
 * atau tombol; menggulir tidak dihitung). Jadi suara menyala sendiri sedini mungkin:
 *   - pengunjung sudah pernah klik di halaman (mis. tombol "Tonton demo") -> bersuara begitu film tampil;
 *   - belum -> bersuara pada klik/tap/tombol pertama di mana pun di halaman.
 * Tombol di atas film untuk mematikannya; setelah dimatikan, suara tidak dinyalakan lagi secara otomatis.
 * Bila pengguna meminta gerakan dikurangi, film tidak diputar otomatis.
 */
export default function FilmPlayer() {
  const ref = useRef<PlayerRef>(null);
  const box = useRef<HTMLDivElement>(null);
  const [sound, setSound] = useState(false);
  const inputProps = useMemo(() => ({ sound }), [sound]);
  const soundOn = useRef(false);
  const userMuted = useRef(false);
  const visible = useRef(false);

  useEffect(() => {
    const el = box.current;
    const player = ref.current;
    if (!el || !player) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const turnOn = (e?: SyntheticEvent) => {
      if (soundOn.current || userMuted.current) return;
      soundOn.current = true;
      setSound(true);
      player.unmute();
      // Event dari interaksi pengguna diteruskan supaya Player boleh memutar audio saat itu juga.
      if (visible.current && !reduced) player.play(e);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible.current = entry.isIntersecting;
        if (!entry.isIntersecting) return player.pause();
        if (navigator.userActivation?.hasBeenActive) turnOn();
        if (!reduced) player.play();
      },
      { threshold: 0.35 }
    );
    io.observe(el);

    const onFirstInteraction = (e: Event) => {
      // Klik pada tombol suara diurus oleh tombol itu sendiri.
      if (e.target instanceof Element && e.target.closest("[data-film-sound]")) return;
      turnOn(e as unknown as SyntheticEvent);
      removeListeners();
    };
    const events = ["pointerdown", "keydown"] as const;
    const removeListeners = () => events.forEach((name) => window.removeEventListener(name, onFirstInteraction, true));
    events.forEach((name) => window.addEventListener(name, onFirstInteraction, true));

    return () => {
      io.disconnect();
      removeListeners();
    };
  }, []);

  const toggleSound = (e: React.MouseEvent<HTMLButtonElement>) => {
    const player = ref.current;
    if (!player) return;
    if (sound) {
      userMuted.current = true;
      soundOn.current = false;
      player.mute();
      setSound(false);
      return;
    }
    userMuted.current = false;
    soundOn.current = true;
    setSound(true);
    player.unmute();
    player.seekTo(0);
    player.play(e);
  };

  return (
    <div ref={box} className="relative w-full h-full">
      <Player
        ref={ref}
        component={AutopilotFilm}
        inputProps={inputProps}
        durationInFrames={FILM_DURATION}
        fps={FILM_FPS}
        compositionWidth={FILM_WIDTH}
        compositionHeight={FILM_HEIGHT}
        style={{ width: "100%", height: "100%" }}
        controls
        showVolumeControls={false}
        loop
        initiallyMuted
        // Klik pada film dipakai untuk menyalakan suara, jadi tidak ikut menjeda; jeda lewat kontrol.
        clickToPlay={false}
        acknowledgeRemotionLicense
      />
      <button
        type="button"
        data-film-sound
        onClick={toggleSound}
        aria-pressed={sound}
        className={`lp-sound lp-mono absolute z-10 top-2.5 md:top-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 h-8 md:h-10 px-3 md:px-4 rounded-full text-[11px] md:text-xs font-bold tracking-wider cursor-pointer transition-colors ${
          sound ? "bg-white/10 text-white hover:bg-white/20 border border-white/20" : "bg-[#7b8aff] text-[#06070d] hover:bg-[#95a1ff]"
        }`}
      >
        {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        {sound ? "MATIKAN SUARA" : "NYALAKAN SUARA"}
        {!sound && <span aria-hidden="true" className="lp-sound-ring" />}
      </button>
    </div>
  );
}
