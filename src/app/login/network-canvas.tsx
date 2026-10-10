"use client";

import React, { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  glow: number; // 0..1, naik saat dekat kursor atau berdenyut
}

const COUNT = 32; // satu titik per akun cabang
const LINK = 150;
const REACH = 190;

/**
 * Jaringan titik yang melayang pelan. Titik dekat kursor menyala dan
 * tersambung ke kursor; sesekali satu titik berdenyut. Berhenti saat tab
 * tersembunyi dan hanya digambar sekali bila pengguna memilih reduced motion.
 */
export function NetworkCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let nodes: Node[] = [];
    const mouse = { x: -9999, y: -9999, active: false };

    const seed = () => {
      nodes = Array.from({ length: COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 1.6 + Math.random() * 1.8,
        glow: 0,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!nodes.length) seed();
      if (still) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            const hot = Math.max(a.glow, b.glow);
            ctx.strokeStyle = `rgba(143,155,255,${(1 - d / LINK) * (0.16 + hot * 0.5)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (mouse.active) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (d < REACH) {
            ctx.strokeStyle = `rgba(190,198,255,${(1 - d / REACH) * 0.55})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        if (n.glow > 0.05) {
          ctx.fillStyle = `rgba(143,155,255,${n.glow * 0.18})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 7 + n.glow * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${200 + n.glow * 55},${208 + n.glow * 47},255,${0.55 + n.glow * 0.45})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + n.glow * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let last = 0;
    let nextPulse = 0;
    const tick = (t: number) => {
      const dt = Math.min(48, t - last || 16);
      last = t;

      if (t > nextPulse) {
        nodes[Math.floor(Math.random() * nodes.length)].glow = 1;
        nextPulse = t + 900 + Math.random() * 1400;
      }

      for (const n of nodes) {
        n.x += n.vx * dt * 0.06 * 16;
        n.y += n.vy * dt * 0.06 * 16;
        if (n.x < -20) n.x = w + 20;
        if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20;
        if (n.y > h + 20) n.y = -20;

        let target = 0;
        if (mouse.active) {
          const d = Math.hypot(n.x - mouse.x, n.y - mouse.y);
          if (d < REACH) {
            target = 1 - d / REACH;
            // tarikan halus ke arah kursor
            n.x += (mouse.x - n.x) * 0.0016 * dt * 0.06 * 16;
            n.y += (mouse.y - n.y) * 0.0016 * dt * 0.06 * 16;
          }
        }
        n.glow += (target - n.glow) * Math.min(1, dt * 0.006);
        if (target === 0 && n.glow < 0.02) n.glow = 0;
      }

      draw();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active =
        mouse.x >= 0 && mouse.y >= 0 && mouse.x <= r.width && mouse.y <= r.height;
    };
    const onLeave = () => (mouse.active = false);
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) raf = requestAnimationFrame(tick);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!still) {
      raf = requestAnimationFrame(tick);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
