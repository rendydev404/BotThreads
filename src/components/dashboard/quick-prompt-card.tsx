"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles, Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const personas = [
  {
    id: "strategist",
    name: "Livia Bator",
    role: "Strategist",
    avatar:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80",
  },
  {
    id: "copywriter",
    name: "Randy Press",
    role: "Copywriter",
    avatar:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&auto=format&fit=crop&q=80",
  },
  {
    id: "analyst",
    name: "Workman",
    role: "Analyst",
    avatar:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&auto=format&fit=crop&q=80",
  },
];

interface QuickPromptCardProps {
  activeAccount?: string;
  accountLabel?: string;
}

export function QuickPromptCard({
  activeAccount = "all",
  accountLabel = "Semua Akun (32 Terhubung)",
}: QuickPromptCardProps) {
  const router = useRouter();
  const [selectedPersona, setSelectedPersona] = useState("strategist");
  const [promptText, setPromptText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [quickResult, setQuickResult] = useState<string | null>(null);

  const handleSend = async () => {
    if (!promptText.trim()) return;
    setIsLoading(true);
    setQuickResult(null);

    try {
      const res = await fetch("/api/bot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: promptText,
          persona: selectedPersona,
          account: activeAccount,
        }),
      });
      const data = await res.json();
      if (data.success && data.message) {
        setQuickResult(data.message);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="neo-card p-6 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#1814F3]" />
            <h4 className="text-base font-bold text-[#343C6A]">
              Quick AI Prompt (Hermes)
            </h4>
          </div>
          <span className="text-xs font-semibold text-[#16DBCC] bg-[#16DBCC]/10 px-2.5 py-0.5 rounded-full">
            AI Assistant
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#718EBF] mb-4">
          <span>Konteks Akun:</span>
          <span className="font-bold text-[#1814F3] bg-[#1814F3]/10 px-2 py-0.5 rounded-md truncate max-w-[200px]">
            {accountLabel}
          </span>
        </div>

        {/* Persona Selectors (No native select) */}
        <div className="flex items-center gap-4 mb-5 overflow-x-auto py-1">
          {personas.map((persona) => {
            const isSelected = selectedPersona === persona.id;
            return (
              <button
                key={persona.id}
                type="button"
                onClick={() => setSelectedPersona(persona.id)}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-full overflow-hidden p-0.5 transition-all",
                    isSelected
                      ? "ring-3 ring-[#1814F3] ring-offset-2 scale-105"
                      : "opacity-70 hover:opacity-100 ring-1 ring-[#EDF2F7]"
                  )}
                >
                  <img
                    src={persona.avatar}
                    alt={persona.name}
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
                <span
                  className={cn(
                    "text-xs font-semibold tracking-tight transition-colors",
                    isSelected ? "text-[#1814F3]" : "text-[#718EBF]"
                  )}
                >
                  {persona.name.split(" ")[0]}
                </span>
                <span className="text-[10px] text-[#718EBF]">
                  {persona.role}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick Result Drawer if response exists */}
        {quickResult && (
          <div className="mb-4 p-4 rounded-2xl bg-[#F4F7FE] border border-[#EDF2F7] text-xs text-[#343C6A] leading-relaxed max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-[#1814F3] flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Jawaban Hermes AI:
              </span>
              <button
                onClick={() => router.push(`/prompt-studio?prompt=${encodeURIComponent(promptText)}`)}
                className="text-[11px] text-[#1814F3] hover:underline inline-flex items-center gap-0.5"
              >
                Buka di Studio <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <p className="whitespace-pre-line">{quickResult}</p>
          </div>
        )}
      </div>

      {/* Custom Pill Input with Send Button (No Native OS controls) */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Tulis prompt analisis atau minta ide konten..."
          className="w-full h-13 pl-5 pr-28 bg-[#F5F7FA] text-[#343C6A] placeholder-[#8BA3CB] text-sm rounded-full border border-transparent focus:border-[#1814F3]/30 focus:bg-white focus:outline-none transition-all"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isLoading || !promptText.trim()}
          className="absolute right-1.5 h-10 px-5 rounded-full bg-[#1814F3] hover:bg-[#120ec0] disabled:bg-[#718EBF]/40 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-[#1814F3]/25 cursor-pointer"
        >
          <span>{isLoading ? "..." : "Send"}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
