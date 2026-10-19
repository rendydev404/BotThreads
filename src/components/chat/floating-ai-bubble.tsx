"use client";

import React, { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Maximize2, Minimize2, GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";
import { useChat } from "./use-chat";

const WIN_W = 420;
const WIN_H = 640;

export function FloatingAiBubble() {
  const pathname = usePathname();
  const chat = useChat();
  const [isOpen, setIsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Posisi jendela: diseret lewat transform (GPU) dan diperbarui via rAF
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const posRef = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (windowRef.current && !isDragging && !isFullScreen) {
      windowRef.current.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }, [position, isDragging, isFullScreen, isOpen]);

  const openWindow = () => {
    if (!initialized.current) {
      initialized.current = true;
      const x = Math.max(16, window.innerWidth - WIN_W - 24);
      const y = Math.max(16, window.innerHeight - WIN_H - 24);
      posRef.current = { x, y };
      setPosition({ x, y });
    }
    setIsOpen(true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullScreen || (e.target as HTMLElement).closest("button")) return;
    const start = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: posRef.current.x,
      initialY: posRef.current.y,
    };
    setIsDragging(true);
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      const w = windowRef.current?.offsetWidth || WIN_W;
      const h = windowRef.current?.offsetHeight || WIN_H;
      const x = Math.min(
        Math.max(10, start.initialX + ev.clientX - start.mouseX),
        Math.max(10, window.innerWidth - w - 10)
      );
      const y = Math.min(
        Math.max(10, start.initialY + ev.clientY - start.mouseY),
        Math.max(10, window.innerHeight - h - 10)
      );
      posRef.current = { x, y };
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        if (windowRef.current) {
          windowRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
      });
    };
    const up = () => {
      setIsDragging(false);
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPosition(posRef.current);
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // Esc menutup jendela (atau keluar dari layar penuh dulu)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isFullScreen) setIsFullScreen(false);
      else setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, isFullScreen]);

  // Halaman Studio AI sudah berisi chat penuh, bubble tidak diperlukan di sana
  if (pathname.startsWith("/prompt-studio")) return null;

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={openWindow}
          aria-label="Buka asisten AI"
          className="group fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 w-12 md:w-auto h-12 md:pl-3 md:pr-5 inline-flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-accent to-violet-500 text-on-accent text-sm font-semibold shadow-pop hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
        >
          {/* Di layar kecil cukup ikon, supaya tidak menutupi isi halaman. */}
          <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          <span className="max-md:sr-only">Tanya AI</span>
        </button>
      )}

      {isOpen && (
        <div
          ref={windowRef}
          role="dialog"
          aria-label="Asisten AI"
          style={
            isFullScreen
              ? undefined
              : {
                  position: "fixed",
                  left: 0,
                  top: 0,
                  transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
                  zIndex: 50,
                  willChange: "transform",
                }
          }
          className={cn(
            "bg-surface border border-line flex flex-col overflow-hidden shadow-pop",
            isFullScreen
              ? "fixed inset-2 sm:inset-6 z-50 rounded-2xl max-w-4xl mx-auto"
              : "w-[calc(100vw-1.5rem)] sm:w-[420px] h-[640px] max-h-[calc(100dvh-1.5rem)] rounded-2xl"
          )}
        >
          <div
            onPointerDown={handlePointerDown}
            title={isFullScreen ? undefined : "Tahan dan geser untuk memindahkan"}
            className={cn(
              "h-14 px-4 flex items-center justify-between border-b border-line bg-gradient-to-r from-accent-soft/70 to-transparent select-none touch-none shrink-0",
              !isFullScreen && (isDragging ? "cursor-grabbing" : "cursor-grab")
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {!isFullScreen && (
                <GripHorizontal className="w-4 h-4 text-faint shrink-0" />
              )}
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-violet-500 text-on-accent flex items-center justify-center shrink-0 shadow-sm shadow-accent/30">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="leading-tight min-w-0">
                <h2 className="text-sm font-semibold text-fg truncate">
                  Asisten AI
                </h2>
                <p className="flex items-center gap-1.5 text-xs text-muted truncate">
                  <span className="relative flex w-1.5 h-1.5 shrink-0" aria-hidden>
                    <span className="absolute inset-0 rounded-full bg-success opacity-60 animate-ping" />
                    <span className="relative w-1.5 h-1.5 rounded-full bg-success" />
                  </span>
                  Terhubung ke data semua akun
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setIsFullScreen((v) => !v)}
                className="w-8 h-8 rounded-lg text-muted hover:text-fg hover:bg-subtle flex items-center justify-center transition-colors cursor-pointer"
                title={isFullScreen ? "Perkecil" : "Layar penuh"}
                aria-label={isFullScreen ? "Perkecil" : "Layar penuh"}
              >
                {isFullScreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setIsFullScreen(false);
                }}
                className="w-8 h-8 rounded-lg text-muted hover:text-fg hover:bg-subtle flex items-center justify-center transition-colors cursor-pointer"
                title="Tutup"
                aria-label="Tutup"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          <ChatPanel chat={chat} compact={!isFullScreen} className="flex-1" />
        </div>
      )}
    </>
  );
}
