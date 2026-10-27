"use client";

import { useCallback, useRef, useState } from "react";
import type { Report } from "@/lib/report";
import type { ContentDraft, QueueResultDTO } from "@/lib/content-types";
import type { PublishIntent } from "@/lib/content-intent";
import type { ActionPlan } from "@/lib/action-plan";
import type { RolePromptProfileDTO } from "./role-prompt-card";
import { currentLocale, tr } from "@/lib/i18n/core";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  isError?: boolean;
  report?: Report;
  /** Draf postingan siap edit dari asisten (FR-3) */
  drafts?: ContentDraft[];
  /** Menampilkan Multi-Agent Orchestrator UI */
  showOrchestrator?: boolean;
  /** Cakupan akun belum jelas: tampilkan dialog pilihan akun. */
  scopeAsk?: { topic: string; time: string | null; publish: PublishIntent | null };
  /** Cakupan jelas dari chat: orkestrator langsung berjalan untuk akun ini (null = semua). */
  orchestrator?: { accountIds: string[] | null; topic: string; time: string | null; publish: PublishIntent | null };
  /** Draf satu akun yang sudah otomatis masuk antrean (id draf -> hasil). */
  queued?: Record<string, QueueResultDTO>;
  /** Ringkasan + penutup setelah semua tugas rencana aksi selesai. */
  kind?: "execution";
  /** Rencana aksi otomatis dari saran asisten (kartu pilihan waktu posting). */
  plan?: ActionPlan;
  /** Prompt peran: versi ringkas untuk Profil AI akun (bisa diterapkan sekali klik). */
  rolePrompt?: RolePromptProfileDTO;
  /** Kartu sudah tampil, insight AI masih disusun */
  pending?: boolean;
}

const nowLabel = () =>
  new Intl.DateTimeFormat(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(new Date());

/**
 * Teks pesan untuk riwayat yang dikirim ke server: isi pesan ditambah lampiran terstruktur (rencana
 * aksi, draf) yang hanya tampil sebagai kartu di UI, supaya AI tahu apa yang ada di layar pengguna.
 */
function historyText(m: ChatMessage): string {
  let t = m.content;
  if (m.plan?.tasks.length) {
    t +=
      "\n\n[RENCANA AKSI]\n" +
      m.plan.tasks
        .map(
          (x, i) =>
            `${i + 1}. ${x.title} | akun: ${x.accountNames.length ? x.accountNames.map((n) => "@" + n).join(", ") : "semua akun siap"} | isi: ${x.topic}`
        )
        .join("\n");
  }
  if (m.drafts?.length) {
    t +=
      "\n\n[DRAF]\n" +
      m.drafts
        .slice(0, 5)
        .map((d, i) => `${i + 1}. ${d.username ? "@" + d.username : "akun"}: ${d.text.slice(0, 300)}`)
        .join("\n");
  }
  return t;
}

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

      // Draf terakhir dari asisten, dipakai untuk perintah lanjutan ("ganti draf 2 lebih singkat")
      const lastWithDrafts = [...history].reverse().find((m) => m.drafts?.length);
      const lastDrafts = (lastWithDrafts?.drafts ?? []).slice(0, 5).map((d) => ({ threadsAccountId: d.threadsAccountId, text: d.text }));

      const post = (extra: object) =>
        fetch("/api/bot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            account,
            lastDrafts,
            history: history
              .filter((m) => !m.isError)
              .slice(-10)
              .map((m) => ({
                sender: m.role === "user" ? "user" : "bot",
                text: historyText(m),
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
              m.id === id ? { ...m, content: data.message, pending: false, report: data.report ?? m.report, drafts: data.drafts?.length ? data.drafts : m.drafts, showOrchestrator: data.showOrchestrator ?? m.showOrchestrator, scopeAsk: data.askScope ?? m.scopeAsk, orchestrator: data.orchestrator ?? m.orchestrator, queued: data.queued ?? m.queued, plan: data.plan ?? m.plan, rolePrompt: data.rolePrompt ?? m.rolePrompt } : m
            )
          );
        } else {
          update((prev) => [
            ...prev,
            { id: nextId(), role: "assistant", content: data.message, time: nowLabel(), report: data.report, drafts: data.drafts?.length ? data.drafts : undefined, showOrchestrator: data.showOrchestrator, scopeAsk: data.askScope, orchestrator: data.orchestrator, queued: data.queued, plan: data.plan, rolePrompt: data.rolePrompt },
          ]);
        }
      } catch {
        if (cardId) {
          const id = cardId;
          update((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: tr("Insight AI belum bisa dimuat. Angka di atas tetap akurat."), pending: false } : m
            )
          );
        } else {
          update((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "assistant",
              content: tr("Maaf, jawaban belum bisa diambil. Periksa koneksi lalu coba lagi."),
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

  /**
   * Setelah semua tugas rencana aksi selesai: kirim hasil nyata ke server dan tambahkan ringkasan +
   * penutup sebagai pesan asisten. Tidak memblokir kolom input.
   */
  const summarize = useCallback(
    async (execution: unknown) => {
      const id = nextId();
      update((prev) => [
        ...prev,
        { id, role: "assistant", content: "", time: nowLabel(), pending: true, kind: "execution" },
      ]);
      try {
        const res = await fetch("/api/bot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Ringkas hasil eksekusi", execution }),
        });
        const data = await res.json();
        if (!data.success || !data.message) throw new Error(data.error || "Respons kosong");
        update((prev) => prev.map((m) => (m.id === id ? { ...m, content: data.message, pending: false } : m)));
      } catch {
        update((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  content: tr(
                    "Semua tugas selesai dikerjakan. Ringkasan rincinya belum bisa dimuat; cek kartu tiap tugas di atas atau buka Jadwal Konten."
                  ),
                  pending: false,
                }
              : m
          )
        );
      }
    },
    [update]
  );

  /** Jawab ulang pertanyaan pengguna terakhir: jawaban sesudahnya dibuang, pertanyaannya dipertahankan. */
  const regenerate = useCallback(() => {
    if (busy.current) return;
    const msgs = messagesRef.current;
    let idx = msgs.length - 1;
    while (idx >= 0 && msgs[idx].role !== "user") idx--;
    if (idx < 0) return;
    const question = msgs[idx];
    update(() => msgs.slice(0, idx + 1));
    void request(question.content, msgs.slice(0, idx));
  }, [request, update]);

  const reset = useCallback(() => {
    if (busy.current) return;
    update(() => []);
  }, [update]);

  return { messages, isLoading, send, retry, regenerate, summarize, reset };
}

export type ChatApi = ReturnType<typeof useChat>;

