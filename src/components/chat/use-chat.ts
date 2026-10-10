"use client";

import { useCallback, useRef, useState } from "react";
import type { Report } from "@/lib/report";

/** Tombol aksi cepat (seperti tombol di bot Telegram). */
export const quickActions = [
  { label: "Ringkasan 7 hari", prompt: "Ringkasan performa 7 hari terakhir" },
  { label: "Ringkasan 30 hari", prompt: "Ringkasan performa 30 hari terakhir" },
  { label: "Peringkat views", prompt: "Peringkat akun berdasarkan views minggu ini" },
  { label: "Postingan terbaik", prompt: "Apa pola postingan terbaik dan kenapa berhasil?" },
  { label: "Ide konten", prompt: "Buatkan 3 ide postingan Threads untuk besok berdasarkan postingan terbaik" },
  { label: "Kenapa ER rendah?", prompt: "Kenapa interaksi rendah dan apa solusinya?" },
];

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  isError?: boolean;
  report?: Report;
  /** Kartu sudah tampil, insight AI masih disusun */
  pending?: boolean;
}

const nowLabel = () =>
  new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

let counter = 0;
const nextId = () => `m-${Date.now()}-${counter++}`;

export function useChat(account = "all") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastUserText = useRef("");
  const busy = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const update = useCallback((fn: (prev: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = fn(messagesRef.current);
    setMessages(messagesRef.current);
  }, []);

  const request = useCallback(
    async (text: string, history: ChatMessage[]) => {
      busy.current = true;
      setIsLoading(true);

      const post = (extra: object) =>
        fetch("/api/bot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            account,
            history: history
              .filter((m) => !m.isError)
              .slice(-6)
              .map((m) => ({
                sender: m.role === "user" ? "user" : "bot",
                text: m.content,
              })),
            ...extra,
          }),
        }).then((r) => r.json());

      let cardId: string | null = null;
      try {
        // Tahap 1: kartu laporan tampil langsung (tanpa menunggu AI)
        const quick = await post({ cardOnly: true }).catch(() => null);
        if (quick?.report) {
          cardId = nextId();
          const id = cardId;
          update((prev) => [
            ...prev,
            { id, role: "assistant", content: "", time: nowLabel(), report: quick.report, pending: true },
          ]);
        }

        // Tahap 2: insight / jawaban dari AI
        const data = await post({});
        if (!data.success || !data.message) {
          throw new Error(data.error || "Respons kosong");
        }
        if (cardId) {
          const id = cardId;
          update((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: data.message, pending: false, report: data.report ?? m.report } : m
            )
          );
        } else {
          update((prev) => [
            ...prev,
            { id: nextId(), role: "assistant", content: data.message, time: nowLabel(), report: data.report },
          ]);
        }
      } catch {
        if (cardId) {
          const id = cardId;
          update((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: "Insight AI belum bisa dimuat. Angka di atas tetap akurat.", pending: false } : m
            )
          );
        } else {
          update((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: "Maaf, jawaban belum bisa diambil. Periksa koneksi lalu coba lagi.",
              time: nowLabel(),
              isError: true,
            },
          ]);
        }
      } finally {
        busy.current = false;
        setIsLoading(false);
      }
    },
    [account, update]
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy.current) return;
      lastUserText.current = text;
      const history = messagesRef.current;
      update((prev) => [
        ...prev,
        { id: nextId(), role: "user", content: text, time: nowLabel() },
      ]);
      void request(text, history);
    },
    [request, update]
  );

  const retry = useCallback(() => {
    if (busy.current || !lastUserText.current) return;
    // buang pesan error terakhir, lalu kirim ulang pertanyaan yang sama
    const history = messagesRef.current.filter((m) => !m.isError);
    const withoutLastUser = history.slice(0, -1);
    update(() => history);
    void request(lastUserText.current, withoutLastUser);
  }, [request, update]);

  const reset = useCallback(() => {
    if (busy.current) return;
    update(() => []);
  }, [update]);

  return { messages, isLoading, send, retry, reset };
}

export type ChatApi = ReturnType<typeof useChat>;
