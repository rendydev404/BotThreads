"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const pad = (n: number): string => String(n).padStart(2, "0");
/** Menggulir halaman dari atas ke bawah = satu hari autopilot, 06.00 sampai 22.00. */
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 22 * 60;

/**
 * Pembungkus halaman perkenalan yang menghidupkan geraknya. Isi tetap dirender server; komponen ini
 * hanya memasang pendengar dan menulis variabel CSS (tanpa render ulang React):
 *   [data-reveal]        muncul saat masuk layar
 *   [data-drift="0.2"]   bergeser sebesar gulir x faktor (untuk lapisan di bagian pembuka)
 *   [data-parallax="x"]  bergeser relatif terhadap posisi induknya di layar (data-axis="x" = mendatar)
 *   [data-spot]          titik aksen mengikuti kursor (--mx/--my)
 *   [data-clock], [data-progress]  jam simulasi dan bilah kemajuan di header
 * Satu pendengar gulir pasif + satu requestAnimationFrame; semuanya mati bila pengguna meminta
 * gerakan dikurangi.
 */
export function LandingMotion({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    root.dataset.anim = "on";
    const observed = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );
    const observeReveals = () => {
      root.querySelectorAll("[data-reveal]:not([data-in])").forEach((el) => {
        if (!observed.has(el)) {
          observed.add(el);
          io.observe(el);
        }
      });
    };
    observeReveals();
    const mo = new MutationObserver(() => observeReveals());
    mo.observe(root, { childList: true, subtree: true });

    const clock = root.querySelector<HTMLElement>("[data-clock]");
    // Variabel gulir ditulis ke elemen yang memakainya saja: menulis ke akar .lp memaksa browser
    // menghitung ulang gaya seluruh halaman di setiap frame gulir.
    const bars = [...root.querySelectorAll<HTMLElement>(".lp-progress")];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const drifts = reduced ? [] : [...root.querySelectorAll<HTMLElement>("[data-drift]")].map((el) => ({ el, k: Number(el.dataset.drift) || 0 }));
    const layers = reduced
      ? []
      : [...root.querySelectorAll<HTMLElement>("[data-parallax]")].map((el) => ({ el, k: Number(el.dataset.parallax) || 0, x: el.dataset.axis === "x" }));

    let frame = 0;
    let lastClock = "";
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const vh = window.innerHeight;
      const max = Math.max(1, document.documentElement.scrollHeight - vh);
      const progress = Math.min(1, Math.max(0, y / max));

      // Baca semua posisi dulu, baru menulis, supaya browser tidak menghitung tata letak berulang.
      // Posisi dibaca dari induk (yang tidak digeser), jadi geseran tidak memengaruhi bacaan berikutnya.
      const offsets = layers.map(({ el, k }) => {
        const r = (el.parentElement ?? el).getBoundingClientRect();
        return r.bottom < -200 || r.top > vh + 200 ? null : (r.top + r.height / 2 - vh / 2) * k;
      });

      // Atribut di akar hanya disentuh saat statusnya berubah (sekali saat mulai/berhenti di puncak).
      const scrolled = y > 8;
      if (scrolled !== "scrolled" in root.dataset) {
        if (scrolled) root.dataset.scrolled = "";
        else delete root.dataset.scrolled;
      }
      const p = progress.toFixed(3);
      for (const bar of bars) bar.style.setProperty("--progress", p);
      if (clock) {
        const minutes = Math.round(DAY_START_MIN + progress * (DAY_END_MIN - DAY_START_MIN));
        const text = `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}`;
        if (text !== lastClock) clock.textContent = lastClock = text;
      }
      // Lapisan pembuka berhenti dihitung setelah lewat dari layar.
      if (y < vh * 1.6) for (const { el, k } of drifts) el.style.setProperty("--p", `${(y * k).toFixed(1)}px`);
      layers.forEach(({ el, x }, i) => {
        const v = offsets[i];
        if (v !== null) el.style.setProperty(x ? "--px" : "--p", `${v.toFixed(1)}px`);
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    // Titik aksen mengikuti kursor: hanya untuk penunjuk halus (mouse/trackpad).
    const spot = root.querySelector<HTMLElement>("[data-spot]");
    let spotFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (!spot || spotFrame) return;
      spotFrame = requestAnimationFrame(() => {
        spotFrame = 0;
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(0)}px`);
        // Lapisan titik dimulai 80px di atas pembungkusnya (lihat landing.css).
        spot.style.setProperty("--my", `${(e.clientY - r.top + 80).toFixed(0)}px`);
      });
    };
    const fine = !reduced && window.matchMedia("(pointer: fine)").matches;
    if (fine && spot) spot.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      mo.disconnect();
      io.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      spot?.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(spotFrame);
    };
  }, []);

  return (
    <div ref={ref} className={cn("lp", className)}>
      {children}
    </div>
  );
}

/**
 * Efek magnet: anak elemen tertarik beberapa piksel ke arah kursor saat didekati. Hanya transform
 * (tanpa render ulang React), satu requestAnimationFrame per gerak; mati di layar sentuh atau bila
 * gerakan dikurangi.
 */
export function Magnetic({ children, className, strength = 0.25 }: { children: React.ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) * strength;
        const y = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.setProperty("--mgx", `${x.toFixed(1)}px`);
        el.style.setProperty("--mgy", `${y.toFixed(1)}px`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      el.style.setProperty("--mgx", "0px");
      el.style.setProperty("--mgy", "0px");
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, [strength]);

  return (
    <span ref={ref} className={cn("lp-magnet", className)}>
      {children}
    </span>
  );
}

/** Miring halus mengikuti kursor (maksimal beberapa derajat). Tidak aktif di layar sentuh atau bila gerakan dikurangi. */
export function Tilt({ children, className, max = 5 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${(-y * max * 0.7).toFixed(2)}deg`);
      });
    };
    const onLeave = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, [max]);

  return (
    <div ref={ref} className={cn("lp-tilt", className)}>
      {children}
    </div>
  );
}
