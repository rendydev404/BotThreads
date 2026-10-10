"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Send,
  Sparkles,
  Bot,
  Copy,
  Check,
  RotateCw,
  SendHorizontal,
  Cpu,
  Layers,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const suggestionChips = [
  "Analisis Performa 7 Hari Terakhir",
  "Buat 3 Ide Post Threads Besok",
  "Evaluasi Postingan Flop & Hook",
  "Rekomendasi Waktu Posting Paling Efektif",
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolUsed?: string;
  latencyMs?: number;
}

function PromptStudioInner() {
  const searchParams = useSearchParams();
  const initialPrompt = searchParams.get("prompt") || "";

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-1",
      role: "assistant",
      content: `Halo! Saya Hermes AI Assistant untuk analisis akun Threads @sukashawarma.

Data performa akun Anda telah disinkronkan secara real-time dari database. Anda dapat meminta saya untuk menganalisis retensi penayangan, mengevaluasi postingan berkinerja rendah, atau membuat draf konten copywriting baru dengan hook viral.

Silakan pilih persona di atas atau gunakan salah satu rekomendasi prompt di bawah ini.`,
      timestamp: "09:00 WIB",
      toolUsed: "ringkasan_semua_akun",
      latencyMs: 84,
    },
  ]);

  const [inputPrompt, setInputPrompt] = useState(initialPrompt);
  const [selectedPersona, setSelectedPersona] = useState<"strategist" | "copywriter" | "analyst">("strategist");
  const [isSending, setIsSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [telegramSentId, setTelegramSentId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (initialPrompt && messages.length === 1) {
      handleSendPrompt(initialPrompt);
    }
  }, [initialPrompt]);

  const handleSendPrompt = async (promptToSend?: string) => {
    const text = (promptToSend || inputPrompt).trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Intl.DateTimeFormat("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      }).format(new Date()) + " WIB",
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt("");
    setIsSending(true);

    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          persona: selectedPersona,
        }),
      });

      const data = await res.json();
      if (data.success && data.message) {
        const assistantMsg: ChatMessage = {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: data.message,
          timestamp: new Intl.DateTimeFormat("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Jakarta",
          }).format(new Date()) + " WIB",
          toolUsed: data.meta?.toolUsed || "ringkasan_semua_akun",
          latencyMs: data.meta?.latencyMs || 112,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error(data.error || "Gagal memproses prompt");
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `Maaf, terjadi kendala saat menghubungi engine Hermes: ${err.message}. Silakan periksa koneksi bot di VPS.`,
        timestamp: "WIB",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsSending(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendToTelegram = (id: string) => {
    setTelegramSentId(id);
    setTimeout(() => setTelegramSentId(null), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Top Engine & Target Account Status Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Gateway Box */}
        <div className="neo-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1814F3]/10 text-[#1814F3] flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#343C6A]">Hermes Agent v3.4</p>
              <p className="text-[11px] text-[#718EBF]">Profile: threads (VPS:8643)</p>
            </div>
          </div>
          <span className="w-2.5 h-2.5 rounded-full bg-[#16DBCC] animate-pulse" />
        </div>

        {/* Model Box */}
        <div className="neo-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#16DBCC]/10 text-[#16DBCC] flex items-center justify-center">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#343C6A]">Model Sosmed Combo</p>
              <p className="text-[11px] text-[#718EBF]">via 9router (Latency ~112ms)</p>
            </div>
          </div>
          <span className="text-[10px] font-mono font-bold text-[#1814F3] bg-[#1814F3]/10 px-2 py-0.5 rounded-full">
            Active
          </span>
        </div>

        {/* Target Account Box */}
        <div className="neo-card p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FFBB38]/10 text-[#FFBB38] flex items-center justify-center">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#343C6A]">Target Live Akun</p>
              <p className="text-[11px] text-[#718EBF]">@sukashawarma (184.2K views)</p>
            </div>
          </div>
          <span className="text-xs text-[#16DBCC] font-bold">Live Synced</span>
        </div>
      </div>

      {/* Main Chat & Prompting Container */}
      <div className="neo-card p-5 md:p-7 flex flex-col h-[650px] relative">
        {/* Header inside Studio: Persona Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#EDF2F7]">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#1814F3]" />
            <h3 className="text-base font-bold text-[#343C6A]">
              Hermes AI Prompt Studio
            </h3>
          </div>

          {/* Persona Switcher Tabs */}
          <div className="flex items-center p-1 bg-[#F5F7FA] rounded-full text-xs font-medium">
            <button
              onClick={() => setSelectedPersona("strategist")}
              className={cn(
                "px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
                selectedPersona === "strategist"
                  ? "bg-[#1814F3] text-white font-semibold shadow-xs"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Strategist (Livia)
            </button>
            <button
              onClick={() => setSelectedPersona("copywriter")}
              className={cn(
                "px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
                selectedPersona === "copywriter"
                  ? "bg-[#1814F3] text-white font-semibold shadow-xs"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Copywriter (Randy)
            </button>
            <button
              onClick={() => setSelectedPersona("analyst")}
              className={cn(
                "px-3.5 py-1.5 rounded-full transition-all cursor-pointer",
                selectedPersona === "analyst"
                  ? "bg-[#1814F3] text-white font-semibold shadow-xs"
                  : "text-[#718EBF] hover:text-[#343C6A]"
              )}
            >
              Analyst (Workman)
            </button>
          </div>
        </div>

        {/* Suggestion Chips */}
        <div className="flex items-center gap-2 py-3 overflow-x-auto no-scrollbar">
          {suggestionChips.map((chip) => (
            <button
              key={chip}
              onClick={() => handleSendPrompt(chip)}
              disabled={isSending}
              className="shrink-0 px-3.5 py-1.5 rounded-full bg-[#F4F7FE] hover:bg-[#EAEFF8] text-[#1814F3] text-xs font-semibold border border-[#EDF2F7] transition-all cursor-pointer disabled:opacity-50"
            >
              + {chip}
            </button>
          ))}
        </div>

        {/* Messages List Area */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-2 py-3">
          {messages.map((msg) => {
            const isUser = msg.role === "user";

            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col max-w-[85%] md:max-w-[75%]",
                  isUser ? "ml-auto items-end" : "mr-auto items-start"
                )}
              >
                {/* Meta details if bot */}
                {!isUser && msg.toolUsed && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-mono bg-[#16DBCC]/15 text-[#10958a] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16DBCC]" />
                      mcp: {msg.toolUsed} ({msg.latencyMs}ms)
                    </span>
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={cn(
                    "p-4 rounded-3xl text-sm leading-relaxed",
                    isUser
                      ? "bg-[#1814F3] text-white rounded-br-xs shadow-md shadow-[#1814F3]/20"
                      : "bg-[#F4F7FE] text-[#343C6A] rounded-bl-xs border border-[#EDF2F7]"
                  )}
                >
                  <p className="whitespace-pre-line">{msg.content}</p>
                </div>

                {/* Message Footer Actions */}
                <div className="flex items-center gap-3 mt-1.5 px-1 text-[11px] text-[#718EBF]">
                  <span>{msg.timestamp}</span>

                  {!isUser && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(msg.content, msg.id)}
                        className="hover:text-[#1814F3] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-[#16DBCC]" />
                            <span className="text-[#16DBCC]">Tersalin</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Salin Teks</span>
                          </>
                        )}
                      </button>

                      <span className="text-[#EDF2F7]">|</span>

                      <button
                        onClick={() => handleSendToTelegram(msg.id)}
                        className="hover:text-[#1814F3] inline-flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {telegramSentId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-[#16DBCC]" />
                            <span className="text-[#16DBCC]">Terkirim ke Bot Telegram</span>
                          </>
                        ) : (
                          <>
                            <SendHorizontal className="w-3 h-3" />
                            <span>Kirim ke Bot Telegram</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-[#718EBF] bg-[#F4F7FE] px-4 py-3 rounded-2xl w-fit border border-[#EDF2F7]">
              <div className="w-4 h-4 border-2 border-[#1814F3] border-t-transparent rounded-full animate-spin" />
              <span>Hermes AI sedang mengolah metrik akun...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Floating Pill Input */}
        <div className="pt-3 border-t border-[#EDF2F7]">
          <div className="relative flex items-center">
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendPrompt()}
              placeholder="Tulis instruksi untuk Hermes AI (contoh: Analisis jam posting terbaik minggu ini)..."
              disabled={isSending}
              className="w-full h-13 pl-6 pr-32 bg-[#F5F7FA] text-[#343C6A] placeholder-[#8BA3CB] text-sm rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
            />
            <button
              onClick={() => handleSendPrompt()}
              disabled={isSending || !inputPrompt.trim()}
              className="absolute right-1.5 h-10 px-5 rounded-full bg-[#1814F3] hover:bg-[#120ec0] disabled:bg-[#718EBF]/40 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-[#1814F3]/25 cursor-pointer"
            >
              <span>{isSending ? "Mengirim..." : "Kirim"}</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PromptStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-[#718EBF]">
          Memuat Hermes AI Prompt Studio...
        </div>
      }
    >
      <PromptStudioInner />
    </Suspense>
  );
}
