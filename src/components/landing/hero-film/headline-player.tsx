"use client";

import { useEffect, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { HEADLINE_DURATION, HEADLINE_FPS, HeadlineFilm } from "./headline-film";

/**
 * Player sekali-putar untuk intro judul. Ukuran komposisi = ukuran kotak teks asli (skala 1), jadi
 * hasilnya menimpa teks asli tepat di tempatnya. Memanggil `onStart` saat frame pertama siap (teks asli
 * baru boleh disembunyikan saat itu) dan `onDone` saat selesai.
 */
export default function HeadlinePlayer({ width, height, onStart, onDone }: { width: number; height: number; onStart: () => void; onDone: () => void }) {
  const ref = useRef<PlayerRef>(null);

  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    player.addEventListener("ended", onDone);
    player.play();
    onStart();
    return () => player.removeEventListener("ended", onDone);
  }, [onStart, onDone]);

  return (
    <Player
      ref={ref}
      component={HeadlineFilm}
      durationInFrames={HEADLINE_DURATION}
      fps={HEADLINE_FPS}
      compositionWidth={width}
      compositionHeight={height}
      style={{ width, height, overflow: "visible" }}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      initiallyMuted
      acknowledgeRemotionLicense
    />
  );
}
