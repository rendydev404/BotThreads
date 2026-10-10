"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  Send,
  Copy,
  Check,
  RotateCw,
  GripHorizontal,
  Bot,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: string;
}

const quickPrompts = [
  "Ringkas performa 32 akun",
  "Akun mana yang paling banyak posting?",
  "Akun mana views-nya tertinggi?",
  "Bikinin 3 draf hook postingan Threads",
];

const personas = [
  { id: "strategist", label: "Strategi", name: "Livia" },
  { id: "copywriter", label: "Copywriter", name: "Randy" },
  { id: "analyst", label: "Analis", name: "Workman" },
];

export function FloatingAiBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [activePersona, setActivePersona] = useState("strategist");
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "bot",
      text: "Halo! Saya Asisten AI Suka Shawarma yang terhubung langsung ke database 32 akun Threads (193.7K views & 1.680 postingan).\n\nAda yang ingin Anda tanyakan seputar ranking cabang, penayangan, atau draf ide konten baru?",
      timestamp: "Baru saja",
    },
  ]);

  // Ultra-smooth GPU Drag State
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const posRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, initialX: 0, initialY: 0 });
  const rafIdRef = useRef<number | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize position to bottom-right corner safely
  useEffect(() => {
    if (typeof window !== "undefined") {
      const initialX = Math.max(16, window.innerWidth - 440);
      const initialY = Math.max(20, window.innerHeight - 640);
      posRef.current = { x: initialX, y: initialY };
      setPosition({ x: initialX, y: initialY });
    }
  }, []);

  // Sync window transform whenever position state updates (non-dragging)
  useEffect(() => {
    if (windowRef.current && !isDragging && !isFullScreen) {
      windowRef.current.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    }
  }, [position, isDragging, isFullScreen]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  // Mouse / Pointer Move listener (Runs on window, decoupled via RAF for 120Hz smoothness)
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (isFullScreen) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      let nextX = dragStartRef.current.initialX + deltaX;
      let nextY = dragStartRef.current.initialY + deltaY;

      // Viewport bounds clamp
      const winWidth = windowRef.current?.offsetWidth || 420;
      const winHeight = windowRef.current?.offsetHeight || 580;
      const maxX = Math.max(10, window.innerWidth - winWidth - 10);
      const maxY = Math.max(10, window.innerHeight - winHeight - 10);

      nextX = Math.min(Math.max(10, nextX), maxX);
      nextY = Math.min(Math.max(10, nextY), maxY);

      posRef.current = { x: nextX, y: nextY };

      // Update DOM style directly using requestAnimationFrame (Zero React re-render lag)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(() => {
        if (windowRef.current) {
          windowRef.current.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
        }
      });
    },
    [isFullScreen]
  );

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);

    // Save final position to React state
    setPosition(posRef.current);
  }, [onPointerMove]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullScreen) return;

    // Ignore if clicked on buttons or input
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("textarea")) {
      return;
    }

    setIsDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: posRef.current.x,
      initialY: posRef.current.y,
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
  };

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // Send message to backend
  const handleSendMessage = async (textToSend = inputMessage) => {
    const text = textToSend.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          persona: activePersona,
          account: "all",
          history: messages.slice(-6).map((m) => ({
            sender: m.sender,
            text: m.text,
          })),
        }),
      });

      const data = await res.json();
      if (data.success && data.message) {
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: data.message,
          timestamp: new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Maaf, terjadi kendala koneksi ke Hermes AI. Silakan coba kembali.",
          timestamp: "Sekarang",
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Gagal menghubungkan ke Hermes AI server.",
          timestamp: "Sekarang",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      {/* 1. Floating Collapsed Bubble Trigger */}
      {!isOpen && (
        <div className="fixed bottom-20 md:bottom-7 right-5 z-40">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-2.5 px-4 py-3 rounded-full bg-[#1814F3] text-white shadow-xl hover:shadow-2xl hover:bg-[#120ec0] active:scale-95 transition-all cursor-pointer border border-white/20"
            title="Buka Hermes AI Assistant"
          >
            <div className="relative flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#10B981] ring-2 ring-[#1814F3]" />
            </div>
            <span className="text-xs font-bold tracking-tight pr-1">
              Tanya Hermes AI
            </span>
            <span className="hidden group-hover:inline-block text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-semibold">
              Live DB
            </span>
          </button>
        </div>
      )}

      {/* 2. Draggable & Fullscreen Chat Window */}
      {isOpen && (
        <div
          ref={windowRef}
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
            "bg-white border border-[#EDF2F7] flex flex-col overflow-hidden",
            isDragging && "select-none pointer-events-auto",
            isFullScreen
              ? "fixed inset-2 sm:inset-6 z-50 rounded-3xl max-w-5xl mx-auto shadow-2xl transition-all duration-300 ease-out"
              : cn(
                  "w-[94vw] sm:w-[430px] h-[580px] max-h-[85vh] rounded-3xl",
                  isDragging
                    ? "transition-none shadow-[0_30px_70px_rgba(24,20,243,0.22)] scale-[1.008]"
                    : "transition-shadow duration-200 shadow-2xl"
                )
          )}
        >
          {/* Header Bar - High Performance Drag Handle */}
          <div
            onPointerDown={handlePointerDown}
            className={cn(
              "px-5 py-3.5 bg-[#F8FAFC] border-b border-[#EDF2F7] flex items-center justify-between select-none touch-none",
              isFullScreen
                ? "cursor-default"
                : isDragging
                ? "cursor-grabbing bg-[#F1F5F9]"
                : "cursor-grab hover:bg-[#F1F5F9]/80 transition-colors"
            )}
            title={isFullScreen ? undefined : "Klik dan tahan untuk menggeser jendela"}
          >
            <div className="flex items-center gap-2.5 min-w-0 pointer-events-none">
              {!isFullScreen && (
                <div className="flex items-center justify-center p-1 rounded-md text-[#718EBF]">
                  <GripHorizontal className="w-4 h-4" />
                </div>
              )}
              <div className="w-8 h-8 rounded-xl bg-[#1814F3] text-white flex items-center justify-center shrink-0 shadow-xs">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs sm:text-sm font-extrabold text-[#1E293B] truncate">
                    Asisten AI Suka Shawarma
                  </h4>
                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full shrink-0">
                    Live
                  </span>
                </div>
                <p className="text-[10px] text-[#64748B] truncate">
                  Akses real-time 32 akun & 1.680 post
                </p>
              </div>
            </div>

            {/* Window Controls (Not draggable) */}
            <div className="flex items-center gap-1 shrink-0 ml-2">
              <button
                type="button"
                onClick={() => setIsFullScreen(!isFullScreen)}
                className="w-7 h-7 rounded-lg text-[#718EBF] hover:text-[#343C6A] hover:bg-[#EDF2F7] flex items-center justify-center transition-colors cursor-pointer"
                title={isFullScreen ? "Perkecil Jendela" : "Layar Penuh"}
              >
                {isFullScreen ? (
                  <Minimize2 className="w-3.5 h-3.5" />
                ) : (
                  <Maximize2 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-lg text-[#718EBF] hover:text-[#FF4B4A] hover:bg-[#FEE2E2] flex items-center justify-center transition-colors cursor-pointer"
                title="Tutup Chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Persona Strip & Quick Prompt Chips */}
          <div className="p-3 bg-white border-b border-[#EDF2F7] space-y-2">
            {/* Persona Switcher */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-[#718EBF] uppercase tracking-wider pr-1">
                Persona:
              </span>
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePersona(p.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer",
                    activePersona === p.id
                      ? "bg-[#1814F3] text-white shadow-xs"
                      : "bg-[#F4F7FE] text-[#718EBF] hover:text-[#343C6A]"
                  )}
                >
                  {p.name} ({p.label})
                </button>
              ))}
            </div>

            {/* Quick Context Prompt Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {quickPrompts.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSendMessage(q)}
                  disabled={isLoading}
                  className="px-2.5 py-1 rounded-lg bg-[#F8FAFC] border border-[#EDF2F7] text-[10px] text-[#343C6A] hover:border-[#1814F3] hover:text-[#1814F3] font-medium whitespace-nowrap transition-colors cursor-pointer shrink-0"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Message Thread History */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-[#FAFCFF]">
            {messages.map((msg) => {
              const isUser = msg.sender === "user";
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex gap-2.5 max-w-[88%]",
                    isUser ? "ml-auto flex-row-reverse" : "mr-auto"
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[11px] font-bold shadow-xs",
                      isUser ? "bg-[#343C6A]" : "bg-[#1814F3]"
                    )}
                  >
                    {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>

                  {/* Message Bubble */}
                  <div className="space-y-1">
                    <div
                      className={cn(
                        "p-3.5 rounded-2xl text-xs sm:text-[13px] leading-relaxed",
                        isUser
                          ? "bg-[#1814F3] text-white rounded-tr-xs shadow-xs"
                          : "bg-white text-[#343C6A] border border-[#EDF2F7] rounded-tl-xs shadow-xs"
                      )}
                    >
                      <p className="whitespace-pre-line">{msg.text}</p>
                    </div>

                    {/* Footer: Timestamp & Action */}
                    <div
                      className={cn(
                        "flex items-center gap-2 text-[10px] text-[#94A3B8] px-1",
                        isUser ? "justify-end" : "justify-start"
                      )}
                    >
                      <span>{msg.timestamp}</span>
                      {!isUser && (
                        <button
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.text)}
                          className="hover:text-[#1814F3] inline-flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-[#10B981]" />
                              <span>Tersalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Salin</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex gap-2.5 mr-auto max-w-[85%]">
                <div className="w-7 h-7 rounded-full bg-[#1814F3] text-white flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#EDF2F7] rounded-tl-xs shadow-xs flex items-center gap-2 text-xs text-[#718EBF]">
                  <RotateCw className="w-3.5 h-3.5 text-[#1814F3] animate-spin" />
                  <span>Hermes AI menganalisis data database...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input & Send Footer */}
          <div className="p-3 bg-white border-t border-[#EDF2F7]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="relative flex items-center"
            >
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Tanyakan analisis akun, impresi, atau minta draf konten..."
                className="w-full h-11 pl-4 pr-12 text-xs rounded-full bg-[#F5F7FA] text-[#343C6A] placeholder-[#94A3B8] border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !inputMessage.trim()}
                className="absolute right-1.5 w-8 h-8 rounded-full bg-[#1814F3] hover:bg-[#120ec0] disabled:bg-[#CBD5E1] text-white flex items-center justify-center shadow-xs cursor-pointer transition-all"
                title="Kirim pesan"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
