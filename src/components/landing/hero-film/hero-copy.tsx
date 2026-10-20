"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

const HeadlinePlayer = dynamic(() => import("./headline-player"), { ssr: false });

/** Bila Remotion belum siap selewat ini (ms sejak halaman mulai dimuat), teks asli langsung ditampilkan. */
const FALLBACK_MS = 1300;

/**
 * Judul + deskripsi bagian pembuka. Teks asli (children) selalu ada di HTML untuk SEO dan pembaca layar.
 * Di desktop, intro Remotion diputar sekali tepat di atasnya dengan tata letak identik, lalu Player
 * dilepas dan teks asli tampil kembali: tidak ada animasi yang terus memakan CPU setelahnya.
 * Ponsel, gerakan dikurangi, atau Remotion telat dimuat -> teks asli dengan animasi CSS biasa.
 *
 * Keadaan (data-state) dibaca landing.css: kosong = menunggu (teks asli tersembunyi, muncul sendiri
 * setelah 1,3 detik bila tidak ada kabar), "remotion" = intro diputar, "done" = teks asli tampil.
 */
export function HeroCopy({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"" | "remotion" | "done">("");
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const desktop = window.matchMedia("(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
    if (!desktop) return; // CSS ponsel tidak menyembunyikan teks; tidak perlu apa-apa.
    let cancelled = false;
    // Ukur setelah font siap, supaya pemenggalan baris komposisi sama dengan teks asli.
    Promise.all([document.fonts.ready, import("./headline-player")]).then(() => {
      if (cancelled) return;
      if (performance.now() > FALLBACK_MS) {
        setState("done");
        return;
      }
      const r = el.getBoundingClientRect();
      setSize({ width: Math.round(r.width), height: Math.ceil(r.height) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onStart = useCallback(() => setState("remotion"), []);
  const onDone = useCallback(() => {
    setState("done");
    setSize(null);
  }, []);

  return (
    <div ref={ref} className="lp-hero-copy relative" data-state={state || undefined}>
      {children}
      {size && state !== "done" ? (
        <div aria-hidden="true" className="absolute left-0 top-0 pointer-events-none">
          <HeadlinePlayer width={size.width} height={size.height} onStart={onStart} onDone={onDone} />
        </div>
      ) : null}
    </div>
  );
}
