"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

/** Sampul selagi Player belum dimuat: ukurannya sama dengan film supaya tata letak tidak meloncat. */
function Poster() {
  return (
    <div className="lp-film-poster absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
      <span className="w-16 h-16 rounded-full bg-accent text-on-accent flex items-center justify-center shadow-pop">
        <Play className="w-7 h-7 translate-x-0.5" fill="currentColor" />
      </span>
      <span className="lp-mono text-xs font-bold tracking-widest text-muted">MEMUAT DEMO AUTOPILOT</span>
    </div>
  );
}

// Remotion (~beberapa ratus KB) baru diunduh saat bagian ini mendekati layar, bukan saat halaman dibuka.
const FilmPlayer = dynamic(() => import("./film-player"), { ssr: false, loading: Poster });

export function FilmSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "200px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="lp-film relative aspect-video w-full rounded-[1.4rem] overflow-hidden">
      {near ? <FilmPlayer /> : <Poster />}
    </div>
  );
}
