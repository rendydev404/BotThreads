"use client";

import React, { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useChat } from "@/components/chat/use-chat";

function StudioInner() {
  const chat = useChat();
  const initialPrompt = useSearchParams().get("prompt");
  const sentInitial = useRef(false);

  useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      chat.send(initialPrompt);
    }
  }, [initialPrompt, chat]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-fg">Asisten AI</h2>
        <p className="text-sm text-muted mt-1">
          Tanyakan performa cabang, minta analisis, atau minta draf postingan.
        </p>
      </div>

      <section className="card overflow-hidden h-[calc(100dvh-13rem)] min-h-[480px] md:h-[calc(100dvh-11rem)]">
        <ChatPanel chat={chat} />
      </section>
    </div>
  );
}

export default function PromptStudioPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-center text-muted">Memuat…</div>}
    >
      <StudioInner />
    </Suspense>
  );
}
