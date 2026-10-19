/**
 * Tipe bersama server dan klien untuk fitur posting Threads. Tanpa import server
 * (aman dipakai di komponen "use client").
 */

export type PublishReason =
  | "NOT_MAPPED"
  | "NEEDS_RECONNECT"
  | "TOKEN_EXPIRED"
  | "NO_PUBLISH_SCOPE"
  | "OUTLET_INACTIVE"
  | "TEST_RESTRICTED"
  /** Melebihi kuota akun paket (paket diturunkan atau diubah super admin): akun terbaru dihentikan. */
  | "DI_LUAR_KUOTA";

export const REASON_LABEL: Record<PublishReason, string> = {
  NOT_MAPPED: "Belum dipetakan ke cabang",
  NEEDS_RECONNECT: "Perlu dihubungkan ulang di SukaPost",
  TOKEN_EXPIRED: "Token kedaluwarsa, hubungkan ulang di SukaPost",
  NO_PUBLISH_SCOPE: "Izin posting belum diberikan",
  OUTLET_INACTIVE: "Cabang nonaktif",
  TEST_RESTRICTED: "Dibatasi selama masa uji",
  DI_LUAR_KUOTA: "Melebihi kuota akun paket",
};

export interface PublishAccountDTO {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  outletNama: string | null;
  ready: boolean;
  reason?: PublishReason;
}

export interface PublishLimitsDTO {
  maxPostsPerDay: number;
  minGapMinutes: number;
  maxBatchItems: number;
}

export interface AccountsResponse {
  success: true;
  accounts: PublishAccountDTO[];
  publishEnabled: boolean;
  limits: PublishLimitsDTO;
}

/** Jam terbaik akun untuk chip jadwal. */
export interface BestHourDTO {
  hour: number;
  /** Kelipatan terhadap rata-rata views akun; null bila tidak ada pembanding. */
  multiplier: number | null;
  posts: number;
}

export interface ContentDraft {
  id: string;
  threadsAccountId: string;
  username: string | null;
  text: string;
  topicTag: string | null;
  /** ISO UTC */
  suggestedAt: string;
  suggestedLabel: string;
  angle: string;
  rationale: string;
  chars: number;
  bestHours: BestHourDTO[];
  /** Model AI yang menghasilkan draf. */
  model: string;
}

export interface RecommendResponse {
  success: true;
  drafts: ContentDraft[];
  degraded?: boolean;
  message?: string;
  meta: { model: string | null; latencyMs: number };
}

/** Status turunan yang ditampilkan di UI (PRD 6.4). */
export type PostStatusKey = "SCHEDULED" | "QUEUED" | "PROCESSING" | "PUBLISHED" | "FAILED";

export const STATUS_LABEL: Record<PostStatusKey, string> = {
  SCHEDULED: "Terjadwal",
  QUEUED: "Mengantre",
  PROCESSING: "Diproses Threads",
  PUBLISHED: "Terbit",
  FAILED: "Gagal",
};

export interface PostItemDTO {
  /** id ScheduledPost (dipakai untuk edit/batal/kirim ulang) */
  id: string;
  /** id baris penerbitan (kunci unik daftar) */
  dispatchId: string;
  text: string;
  topicTag: string | null;
  /** ISO UTC */
  tayangPada: string;
  status: PostStatusKey;
  statusLabel: string;
  pesanError: string | null;
  releaseUrl: string | null;
  account: {
    id: string | null;
    username: string | null;
    displayName: string;
    avatarUrl: string | null;
  };
  outletNama: string | null;
  /** Dibuat dari dashboard ini (boleh diubah). Selain itu hanya baca. */
  mine: boolean;
  /** Ditulis dan dijadwalkan autopilot (tetap bisa diubah atau dibatalkan). */
  autopilot?: boolean;
  editable: boolean;
  cancellable: boolean;
  retryable: boolean;
}

export interface PostsSummaryDTO {
  scheduledToday: number;
  published7d: number;
  failed7d: number;
  /** Jumlah posting yang Mengantre lebih dari 3 menit (indikasi worker mati). */
  queuedLate: number;
}

export interface PostsResponse {
  success: true;
  items: PostItemDTO[];
  nextCursor: string | null;
  summary?: PostsSummaryDTO;
}

export interface CreatedPostDTO {
  postId: string;
  threadsAccountId: string;
  /** ISO UTC */
  tayangPada: string;
  status: string;
  /** ISO UTC jadwal semula bila sistem menggesernya karena bentrok. */
  rescheduledFrom?: string;
}

/** Item yang dilewati pada mode `partial` beserta alasannya. */
export interface SkippedPostDTO {
  threadsAccountId: string;
  error: string;
}

export interface CreatePostsResponse {
  success: true;
  posts: CreatedPostDTO[];
  replayed?: boolean;
  /** Hanya pada mode `partial`: item yang tidak masuk antrean. */
  skipped?: SkippedPostDTO[];
}

/* ------------------------------------------------------------------ Multi-Agent Orchestrator */

export interface OrchestrateAgent {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  /** Terisi bila akun dilewati (belum siap diposting) beserta alasannya. */
  skipped?: string;
}

/** Peristiwa aliran `/api/content/orchestrate` (satu baris `data:` SSE per peristiwa). */
export type OrchestrateEvent =
  | { type: "plan"; agents: OrchestrateAgent[]; concurrency: number }
  | { type: "start"; accountId: string }
  | { type: "retry"; accountId: string; attempt: number }
  | { type: "draft"; accountId: string; draft: ContentDraft }
  | { type: "error"; accountId: string; error: string }
  /** Mode posting otomatis: draf akun ini sudah masuk antrean (sekarang/terjadwal). */
  | { type: "queued"; accountId: string; postId: string; at: string; mode: "now" | "schedule"; rescheduledFrom?: string }
  | { type: "queue-error"; accountId: string; error: string }
  | { type: "done"; ok: number; failed: number; skipped: number; ms: number }
  | { type: "fatal"; error: string };

export interface ApiError {
  success: false;
  error: string;
  details?: string[];
}

/** Hasil antrean otomatis satu draf (posting dari prompt). */
export type QueueResultDTO =
  | { ok: true; postId: string; at: string; mode: "now" | "schedule"; rescheduledFrom?: string }
  | { ok: false; error: string };
