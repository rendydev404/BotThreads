/**
 * Kontrak data pengerahan buzzer lintas-niche (Konsol Super Admin: /admin/buzzer).
 * Bebas impor server, aman dipakai komponen klien.
 */
import type { VoiceStyle } from "./autopilot-types";

export const BUZZER_SQL_FILE = "sql/029_buzzer.sql";

export type BuzzerAction = "KOMEN" | "REPOST" | "QUOTE";
export const BUZZER_ACTIONS: BuzzerAction[] = ["KOMEN", "REPOST", "QUOTE"];

export const BUZZER_ACTION_LABELS: Record<BuzzerAction, { label: string; desc: string }> = {
  KOMEN: {
    label: "Komentar Lintas-Niche",
    desc: "Balas di kolom komentar dengan gaya natural sesuai jarak niche buzzer",
  },
  REPOST: {
    label: "Repost Langsung",
    desc: "Repost ke beranda akun buzzer tanpa tambahan teks",
  },
  QUOTE: {
    label: "Share Kutipan (Quote)",
    desc: "Bagikan postingan ke feed buzzer sambil menulis kutipan kasual sesuai persona",
  },
};

export type BuzzerNicheRelation = "SEJALUR" | "JEMBATAN" | "JAUH";

export const NICHE_RELATION_META: Record<
  BuzzerNicheRelation,
  { label: string; hint: string; tone: "success" | "accent" | "warning" }
> = {
  SEJALUR: {
    label: "Sejalur (Niche Dekat)",
    hint: "Nimbrung santai karena topik postingan dekat dengan keseharian buzzer",
    tone: "success",
  },
  JEMBATAN: {
    label: "Jembatan Niche",
    hint: "Nimbrung kasual sambil menyambungkan topik ke niche/keseharian buzzer sendiri",
    tone: "accent",
  },
  JAUH: {
    label: "Lintas Jauh (Bertanya)",
    hint: "Nimbrung sebagai netizen awam yang penasaran dan bertanya secara natural",
    tone: "warning",
  },
};

export type BuzzerTaskStatus = "TERJADWAL" | "DIPROSES" | "BERHASIL" | "GAGAL" | "DIBATALKAN";
export type BuzzerCampaignStatus = "BERJALAN" | "SELESAI" | "SEBAGIAN_GAGAL" | "DIBATALKAN";
export type BuzzerInferredFrom = "MANUAL" | "AI" | "AUTO_COMMENT" | "HISTORI";

export interface BuzzerWorkspaceDTO {
  id: string;
  nama: string;
  slug: string;
}

export interface BuzzerAccountDTO {
  accountId: string;
  workspaceId: string;
  workspaceNama: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  needsReconnect: boolean;
  accessExpiresAt: string;
  scopes: string[];
  outletNama: string | null;
  aktif: boolean;
  /** Token masih berlaku, tidak butuh hubungkan ulang, dan memiliki izin publish. */
  ready: boolean;
  niche: string;
  persona: string;
  voiceStyle: VoiceStyle;
  catatan: string | null;
  inferredFrom: BuzzerInferredFrom;
  updatedAt: string | null;
  samplePosts: string[];
  tasksToday: number;
  tasksTotal: number;
}

export interface BuzzerTargetAccountDTO {
  accountId: string;
  workspaceId: string;
  workspaceNama: string;
  tenantId: string;
  tenantNama: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  needsReconnect: boolean;
  accessExpiresAt: string;
  outletNama: string | null;
  brief: string | null;
  pillars: { key: string; bobot?: number }[];
  postCount: number;
}

export interface BuzzerTargetPostDTO {
  mediaId: string;
  mediaType: string;
  text: string;
  permalink: string | null;
  postedAt: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  buzzerKomen: number;
  buzzerRepost: number;
  buzzerQuote: number;
  buzzerPending: number;
}

export interface BuzzerStatsDTO {
  totalBuzzers: number;
  readyBuzzers: number;
  profiledBuzzers: number;
  totalCampaigns: number;
  activeCampaigns: number;
  queuedTasks: number;
  doneToday: number;
  doneTotal: number;
}

export interface BuzzerOverviewResponse {
  success: true;
  installed: boolean;
  workspaces: BuzzerWorkspaceDTO[];
  buzzers: BuzzerAccountDTO[];
  targets: BuzzerTargetAccountDTO[];
  stats: BuzzerStatsDTO;
}

export interface BuzzerPostsResponse {
  success: true;
  items: BuzzerTargetPostDTO[];
}

export interface BuzzerDraftItem {
  buzzerAccountId: string;
  action: "KOMEN" | "QUOTE";
  nicheRelation: BuzzerNicheRelation;
  text: string;
  alasanRelasi: string;
}

export interface BuzzerDraftResponse {
  success: true;
  targetNiche: string;
  items: BuzzerDraftItem[];
}

export interface BuzzerTaskDTO {
  id: string;
  buzzerAccountId: string;
  buzzerUsername: string | null;
  buzzerDisplayName: string;
  buzzerAvatarUrl: string | null;
  buzzerNiche: string;
  action: BuzzerAction;
  nicheRelation: BuzzerNicheRelation | null;
  text: string | null;
  status: BuzzerTaskStatus;
  attempts: number;
  scheduledAt: string;
  executedAt: string | null;
  resultMediaId: string | null;
  resultPermalink: string | null;
  lastError: string | null;
}

export interface BuzzerCampaignDTO {
  id: string;
  targetAccountId: string | null;
  targetUsername: string;
  targetDisplayName: string | null;
  targetNiche: string | null;
  targetMediaId: string;
  targetText: string;
  targetPermalink: string | null;
  targetPostedAt: string | null;
  actions: BuzzerAction[];
  catatanAdmin: string | null;
  jedaMinDetik: number;
  jedaMaxDetik: number;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  status: BuzzerCampaignStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tasks: BuzzerTaskDTO[];
}

export interface BuzzerCampaignListResponse {
  success: true;
  items: BuzzerCampaignDTO[];
  nextCursor: string | null;
}

export interface BuzzerProfilePatch {
  accountId: string;
  aktif: boolean;
  niche: string;
  persona: string;
  voiceStyle: VoiceStyle;
  catatan?: string | null;
  inferredFrom?: BuzzerInferredFrom;
}

export interface BuzzerTimingPreset {
  key: string;
  label: string;
  hint: string;
  minSec: number;
  maxSec: number;
}

export const BUZZER_TIMING_PRESETS: BuzzerTimingPreset[] = [
  {
    key: "instan",
    label: "Langsung Ramai (0-15 dtk)",
    hint: "Dieksekusi berurutan seketika saat dikerahkan",
    minSec: 0,
    maxSec: 15,
  },
  {
    key: "cepat",
    label: "Natural Cepat (15-60 dtk)",
    hint: "Jeda acak 15-60 detik antar-buzzer agar organik",
    minSec: 15,
    maxSec: 60,
  },
  {
    key: "santai",
    label: "Natural Santai (45-180 dtk)",
    hint: "Menyebar dalam beberapa menit seperti obrolan organik",
    minSec: 45,
    maxSec: 180,
  },
  {
    key: "menyebar",
    label: "Gelombang Bertahap (2-6 mnt)",
    hint: "Jeda panjang antar-akun untuk keramaian bertahap",
    minSec: 120,
    maxSec: 360,
  },
];
