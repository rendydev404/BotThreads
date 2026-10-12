"use client";

/**
 * Keadaan Multi-Agent Orchestrator per pesan chat, disimpan di luar komponen. Panel chat bisa
 * ditutup, dibesarkan, atau dirender ulang tanpa memutus orkestrasi yang sedang berjalan dan tanpa
 * membuang puluhan draf yang sudah dibuat.
 */
import { useSyncExternalStore } from "react";
import { ContentApiError, cancelPost, createPosts, newIdempotencyKey, orchestrate } from "@/lib/content-client";
import { SLOT_MIN_LEAD_MS } from "@/lib/content-config";
import type { ContentDraft, OrchestrateAgent, OrchestrateEvent } from "@/lib/content-types";
import { parseTopicTag } from "@/lib/threads-text";

export type AgentStatus = "PENDING" | "THINKING" | "RETRYING" | "SUCCESS" | "ERROR" | "SKIPPED";

export interface AgentState extends OrchestrateAgent {
  status: AgentStatus;
  error?: string;
}

export type ItemStatus = "DRAFT" | "SCHEDULING" | "SCHEDULED" | "FAILED" | "CANCELLING";

export interface PublishMode {
  mode: "now" | "schedule";
  dayOffset: number | null;
  hourWib: number | null;
}

export interface ReviewItem {
  accountId: string;
  /** Draf dari agen: sudut, alasan, jam terbaik, saran jam, model. */
  draft: ContentDraft;
  text: string;
  topic: string;
  /** Jam tayang terpilih (ISO UTC); awalnya saran agen untuk akun ini. */
  at: string;
  included: boolean;
  status: ItemStatus;
  error?: string;
  regenerating: boolean;
  /** Id ScheduledPost setelah masuk antrean (untuk dibatalkan). */
  postId?: string;
  /** Masuk antrean lewat posting otomatis: langsung terbit atau terjadwal. */
  queuedMode?: "now" | "schedule";
  /** Jam semula (ISO) bila sistem menggesernya karena bentrok dengan postingan lain. */
  movedFrom?: string;
}

export interface OrchestratorConfig {
  /** "all" atau id akun Threads. */
  account: string;
  /** Subset akun dari chat ("beberapa akun"); dipakai bila `account` = "all". null = semua akun. */
  accountIds: string[] | null;
  /** auto = jam ramai tiap akun (pilihan agen); fixed = satu jam untuk semua. */
  mode: "auto" | "fixed";
  /** "HH:MM" WIB, dipakai saat mode fixed. */
  time: string;
  topic: string;
  /** Posting otomatis dari prompt; null = draf saja (disetujui manual). */
  publish: PublishMode | null;
}

export interface OrchestratorState {
  step: "CONFIG" | "GENERATING" | "REVIEW";
  /** Sudah pernah dijalankan (mencegah peluncuran otomatis ganda saat kartu dirender ulang). */
  launched: boolean;
  config: OrchestratorConfig;
  agents: AgentState[];
  items: ReviewItem[];
  running: boolean;
  scheduling: boolean;
  error: string | null;
  startedAt: number | null;
  elapsedMs: number | null;
}

const INITIAL: OrchestratorState = {
  step: "CONFIG",
  launched: false,
  config: { account: "all", accountIds: null, mode: "auto", time: "", topic: "", publish: null },
  agents: [],
  items: [],
  running: false,
  scheduling: false,
  error: null,
  startedAt: null,
  elapsedMs: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH = 10;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isValidTime = (value: string): boolean => TIME_PATTERN.test(value);

/** Jam yang sudah lewat saat disetujui digeser ke hari berikutnya pada jam yang sama. */
function rollForward(at: string, now: number): string {
  let ms = Date.parse(at);
  while (ms < now + SLOT_MIN_LEAD_MS) ms += DAY_MS;
  return new Date(ms).toISOString();
}

const toItem = (draft: ContentDraft, previous?: ReviewItem): ReviewItem => ({
  accountId: draft.threadsAccountId,
  draft,
  text: draft.text,
  topic: draft.topicTag ?? "",
  at: draft.suggestedAt,
  included: previous?.included ?? true,
  status: "DRAFT",
  regenerating: false,
});

type RunKind = "full" | "retry" | "single";

class OrchestratorSession {
  private state: OrchestratorState = INITIAL;
  private listeners = new Set<() => void>();
  private controllers = new Set<AbortController>();
  private epoch = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): OrchestratorState => this.state;

  private set(patch: Partial<OrchestratorState> | ((s: OrchestratorState) => Partial<OrchestratorState>)) {
    this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    this.listeners.forEach((l) => l());
  }

  private patchAgent(id: string, patch: Partial<AgentState>) {
    this.set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }

  private patchItems(ids: Set<string>, patch: (item: ReviewItem) => Partial<ReviewItem>) {
    this.set((s) => ({ items: s.items.map((i) => (ids.has(i.accountId) ? { ...i, ...patch(i) } : i)) }));
  }

  setConfig = (patch: Partial<OrchestratorConfig>) => {
    this.set((s) => ({ config: { ...s.config, ...patch } }));
  };

  updateItem = (accountId: string, patch: Partial<Pick<ReviewItem, "text" | "topic" | "at" | "included">>) => {
    // Mengubah isi/jam draf yang gagal dijadwalkan mengembalikannya ke status draf (siap dicoba lagi).
    this.patchItems(new Set([accountId]), (i) => ({
      ...patch,
      ...(i.status === "FAILED" ? { status: "DRAFT" as const, error: undefined } : {}),
    }));
  };

  start = () => {
    const { config } = this.state;
    this.set({ step: "GENERATING", launched: true, agents: [], items: [], error: null, elapsedMs: null, startedAt: Date.now() });
    void this.run("full", config.account === "all" ? config.accountIds : [config.account]);
  };

  /** Jalankan langsung dengan cakupan yang dipilih di chat; sekali per sesi. */
  launch = (preset: { accountIds: string[] | null; topic: string; time: string | null; publish?: PublishMode | null }) => {
    if (this.state.launched) return;
    const time = preset.time && isValidTime(preset.time) ? preset.time : null;
    this.setConfig({
      account: preset.accountIds?.length === 1 ? preset.accountIds[0] : "all",
      accountIds: preset.accountIds && preset.accountIds.length > 1 ? preset.accountIds : null,
      topic: preset.topic,
      mode: time ? "fixed" : "auto",
      time: time ?? "",
      publish: preset.publish ?? null,
    });
    this.start();
  };

  retryFailed = () => {
    const ids = this.state.agents.filter((a) => a.status === "ERROR").map((a) => a.id);
    if (ids.length === 0 || this.state.running) return;
    this.set((s) => ({
      error: null,
      agents: s.agents.map((a) => (a.status === "ERROR" ? { ...a, status: "PENDING", error: undefined } : a)),
    }));
    void this.run("retry", ids);
  };

  regenerate = (accountId: string) => {
    const item = this.state.items.find((i) => i.accountId === accountId);
    if (!item || item.regenerating || item.status === "SCHEDULED" || item.status === "SCHEDULING") return;
    this.patchItems(new Set([accountId]), () => ({ regenerating: true, error: undefined }));
    void this.run("single", [accountId], item.text);
  };

  cancel = () => {
    this.controllers.forEach((c) => c.abort());
  };

  reset = () => {
    this.epoch++;
    this.cancel();
    this.set((s) => ({ ...INITIAL, config: s.config, launched: s.launched }));
  };

  private async run(kind: RunKind, accountIds: string[] | null, avoid?: string) {
    const controller = new AbortController();
    this.controllers.add(controller);
    if (kind !== "single") this.set({ running: true });
    const { config } = this.state;
    // Putaran yang dimulai sebelum "atur ulang" tidak boleh menimpa keadaan baru.
    const epoch = this.epoch;

    try {
      await orchestrate(
        {
          accountIds,
          topic: config.topic.trim(),
          time: config.mode === "fixed" && isValidTime(config.time) ? config.time : null,
          avoid: avoid ?? null,
          publish: kind === "single" ? null : config.publish,
        },
        (event) => {
          if (epoch === this.epoch) this.onEvent(kind, event);
        },
        controller.signal
      );
    } catch (err) {
      if (epoch !== this.epoch) return;
      const aborted = (err as Error).name === "AbortError";
      const message = aborted
        ? null
        : err instanceof ContentApiError
          ? err.message
          : "Koneksi terputus sebelum orkestrasi selesai.";
      if (kind === "single" && accountIds) {
        this.patchItems(new Set(accountIds), () => ({ regenerating: false, ...(message ? { error: message } : {}) }));
      } else if (message) {
        this.set({ error: message });
      }
    } finally {
      this.controllers.delete(controller);
      if (epoch !== this.epoch) {
        /* sesi sudah diatur ulang */
      } else if (kind === "single" && accountIds) {
        this.patchItems(new Set(accountIds), () => ({ regenerating: false }));
      } else {
        // Agen yang belum selesai saat aliran berakhir (dibatalkan/terputus) ditandai agar bisa dicoba lagi.
        this.set((s) => ({
          running: false,
          step: "REVIEW",
          elapsedMs: s.elapsedMs ?? (s.startedAt ? Date.now() - s.startedAt : null),
          agents: s.agents.map((a) =>
            a.status === "PENDING" || a.status === "THINKING" || a.status === "RETRYING"
              ? { ...a, status: "ERROR", error: "Dihentikan sebelum selesai." }
              : a
          ),
        }));
      }
    }
  }

  private onEvent(kind: RunKind, event: OrchestrateEvent) {
    switch (event.type) {
      case "plan":
        if (kind === "full") {
          this.set({
            agents: event.agents.map((a) => ({
              ...a,
              status: a.skipped ? "SKIPPED" : "PENDING",
              ...(a.skipped ? { error: a.skipped } : {}),
            })),
          });
        }
        break;
      case "start":
        if (kind !== "single") this.patchAgent(event.accountId, { status: "THINKING", error: undefined });
        break;
      case "retry":
        if (kind !== "single") this.patchAgent(event.accountId, { status: "RETRYING" });
        break;
      case "draft":
        this.patchAgent(event.accountId, { status: "SUCCESS", error: undefined });
        this.set((s) => {
          const previous = s.items.find((i) => i.accountId === event.accountId);
          const next = toItem(event.draft, previous);
          return {
            items: previous
              ? s.items.map((i) => (i.accountId === event.accountId ? next : i))
              : [...s.items, next],
          };
        });
        break;
      case "error":
        if (kind === "single") {
          this.patchItems(new Set([event.accountId]), () => ({ regenerating: false, error: event.error }));
        } else {
          this.patchAgent(event.accountId, { status: "ERROR", error: event.error });
        }
        break;
      case "queued":
        this.patchItems(new Set([event.accountId]), () => ({
          status: "SCHEDULED",
          at: event.at,
          postId: event.postId,
          queuedMode: event.mode,
          movedFrom: event.rescheduledFrom,
          error: undefined,
        }));
        break;
      case "queue-error":
        this.patchItems(new Set([event.accountId]), () => ({ status: "FAILED", error: event.error }));
        break;
      case "done":
        if (kind === "full") this.set({ elapsedMs: event.ms });
        break;
      case "fatal":
        if (kind !== "single") this.set({ error: event.error });
        break;
    }
  }

  /** Batalkan draf yang sudah masuk antrean; drafnya kembali bisa diedit dan dijadwalkan ulang. */
  cancelItem = async (accountId: string) => {
    const item = this.state.items.find((i) => i.accountId === accountId);
    if (!item?.postId || item.status !== "SCHEDULED") return;
    this.patchItems(new Set([accountId]), () => ({ status: "CANCELLING", error: undefined }));
    try {
      await cancelPost(item.postId);
      this.patchItems(new Set([accountId]), () => ({ status: "DRAFT", postId: undefined, queuedMode: undefined }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal membatalkan.";
      this.patchItems(new Set([accountId]), () => ({ status: "SCHEDULED", error: message }));
    }
  };

  /** Masukkan draf terpilih ke antrean, per kelompok `maxBatch`; hasil dilaporkan per akun. */
  schedule = async (maxBatch = DEFAULT_BATCH) => {
    if (this.state.scheduling) return;
    const targets = this.state.items.filter(
      (i) => i.included && !i.regenerating && (i.status === "DRAFT" || i.status === "FAILED")
    );
    if (targets.length === 0) return;

    // Topik yang tidak valid akan menggagalkan seluruh kelompok di server, jadi disaring di sini.
    const valid = targets.filter((i) => i.text.trim() && parseTopicTag(i.topic).ok);
    const invalid = targets.filter((i) => !valid.includes(i));
    this.set({ scheduling: true });
    this.patchItems(new Set(valid.map((i) => i.accountId)), () => ({ status: "SCHEDULING", error: undefined }));
    this.patchItems(new Set(invalid.map((i) => i.accountId)), (i) => ({
      status: "FAILED",
      error: i.text.trim() ? "Topik tidak valid: 1-50 karakter, tanpa titik atau tanda &." : "Teks postingan kosong.",
    }));

    const now = Date.now();
    const size = Math.max(1, maxBatch);
    for (let start = 0; start < valid.length; start += size) {
      const chunk = valid.slice(start, start + size);
      const ids = new Set(chunk.map((i) => i.accountId));
      try {
        const res = await createPosts(
          newIdempotencyKey(),
          chunk.map((i) => {
            const topic = parseTopicTag(i.topic);
            return {
              threadsAccountId: i.accountId,
              text: i.text,
              topicTag: topic.ok ? topic.tag : null,
              publishAt: rollForward(i.at, now),
              aiModel: i.draft.model.slice(0, 80),
              aiEdited: i.text.trim() !== i.draft.text.trim(),
            };
          }),
          { partial: true, autoReschedule: true }
        );
        const posted = new Map(res.posts.map((p) => [p.threadsAccountId, p]));
        const skipped = new Map((res.skipped ?? []).map((s) => [s.threadsAccountId, s.error]));
        this.patchItems(ids, (i) => {
          const post = posted.get(i.accountId);
          if (post) {
            return { status: "SCHEDULED", at: post.tayangPada, postId: post.postId, movedFrom: post.rescheduledFrom, error: undefined };
          }
          return { status: "FAILED", error: skipped.get(i.accountId) ?? "Tidak masuk antrean. Coba lagi." };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal menjadwalkan.";
        this.patchItems(ids, () => ({ status: "FAILED", error: message }));
      }
    }
    this.set({ scheduling: false });
  };
}

const sessions = new Map<string, OrchestratorSession>();

function getSession(id: string): OrchestratorSession {
  let session = sessions.get(id);
  if (!session) {
    session = new OrchestratorSession();
    sessions.set(id, session);
  }
  return session;
}

export type OrchestratorApi = Pick<
  OrchestratorSession,
  "setConfig" | "updateItem" | "start" | "launch" | "cancelItem" | "retryFailed" | "regenerate" | "cancel" | "reset" | "schedule"
>;

/** Keadaan + aksi orkestrator untuk satu pesan chat (`id` = id pesan). */
export function useOrchestrator(id: string): { state: OrchestratorState; api: OrchestratorApi } {
  const session = getSession(id);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { state, api: session };
}
