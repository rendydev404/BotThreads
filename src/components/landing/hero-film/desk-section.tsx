"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n/lang-provider";

/** Sampul selagi Player belum dimuat: ruangan gelap dengan siluet monitor, ukurannya sama dengan film. */
function Poster() {
  const t = useT();
  return (
    <div className="lp-desk-poster absolute inset-0" aria-hidden="true">
      <div className="lp-desk-poster-monitor" />
      <p className="lp-mono absolute left-1/2 top-[44%] -translate-x-1/2 text-[11px] font-bold tracking-widest text-[#a0a6bd]">{t("MENYALAKAN AUTOPILOT…")}</p>
    </div>
  );
}

const loadDeskPlayer = () => import("./desk-player");
const DeskPlayer = dynamic(loadDeskPlayer, { ssr: false, loading: Poster });

let preloading: Promise<unknown> | null = null;
let codeReady = false;
/**
 * Unduh dan siapkan kode animasi tanpa memasangnya, supaya saat kartunya tampil tidak ada jeda berat.
 * Dipanggil saat pengunjung menyentuh kolom "coba untuk bisnis Anda" (di ponsel, menekan "Susun"
 * langsung membawa ke kartu ini). Sengaja tidak dipanggil otomatis: menyiapkan Remotion memakan
 * ~0,5 detik CPU di ponsel lambat, dan itu tidak boleh terjadi di waktu acak saat pengunjung mengetuk.
 */
export function preloadDeskPlayer() {
  if (!preloading) preloading = loadDeskPlayer().then(() => (codeReady = true));
}
/** Sudah siap = boleh digulir halus ke kartunya tanpa tersendat. */
export const isDeskCodeReady = () => codeReady;

/**
 * Kartu animasi di bagian pembuka. Remotion baru diunduh setelah halaman selesai tampil, saat kartu
 * mendekati layar dan browser senggang (paling lambat 1,5 detik). Di desktop kartu terlihat sejak awal;
 * di ponsel kartu ada di bawah lipatan, jadi biayanya baru dibayar saat pengunjung menggulir ke sana.
 */
export function DeskSection() {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let idle = 0;
    let timer = 0;
    const start = () => setReady(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        // Safari belum punya requestIdleCallback: pakai jeda singkat sebagai gantinya.
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(start, { timeout: 1500 });
        else timer = window.setTimeout(start, 600);
      },
      // Baru dimuat saat kartu benar-benar masuk layar: di ponsel kartu ini tepat di bawah lipatan, dan
      // margin pemuatan membuat Remotion ikut disiapkan di detik-detik awal yang paling sibuk.
      { rootMargin: "0px" }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      ref={ref}
      id="hero-board"
      role="img"
      aria-label={t("Animasi: robot tertidur di meja sementara akun Threads di monitornya menulis, memeriksa, dan menerbitkan posting sendiri, lalu suka dan balasan berdatangan.")}
      className="scroll-mt-24 relative w-full aspect-[760/840] rounded-3xl overflow-hidden border border-line shadow-pop bg-[#080a15]"
    >
      {ready ? <DeskPlayer /> : <Poster />}
    </div>
  );
}
