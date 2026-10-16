/**
 * Tipe bersama server dan klien untuk autopilot konten. Tanpa import server (aman dipakai di
 * komponen "use client").
 */
import type { PublishReason } from "./content-types";

export type AutopilotMode = "MATI" | "TINJAU" | "OTOMATIS";
export type SlotStrategy = "JAM_RAMAI" | "JAM_TETAP";
export type SlotKind = "RAMAI" | "EKSPLORASI" | "TETAP" | "CADANGAN" | "TREN";
export type SlotStatus =
  | "DIRENCANAKAN"
  | "MENULIS"
  | "MENUNGGU_TINJAU"
  | "TERANTRE"
  | "TERBIT"
  | "GAGAL"
  | "DILEWATI"
  | "DIBATALKAN";

export const MODE_LABEL: Record<AutopilotMode, string> = {
  MATI: "Mati",
  TINJAU: "Tinjau dulu",
  OTOMATIS: "Otomatis",
};

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  DIRENCANAKAN: "Direncanakan",
  MENULIS: "Sedang ditulis",
  MENUNGGU_TINJAU: "Menunggu tinjauan",
  TERANTRE: "Terjadwal",
  TERBIT: "Terbit",
  GAGAL: "Gagal terbit",
  DILEWATI: "Dilewati",
  DIBATALKAN: "Dibatalkan",
};

export const SLOT_KIND_LABEL: Record<SlotKind, string> = {
  RAMAI: "Jam ramai",
  EKSPLORASI: "Eksplorasi",
  TETAP: "Jam tetap",
  CADANGAN: "Jam bawaan",
  TREN: "Tren",
};

/** Batas pengaturan (dicerminkan di CHECK tabel AutopilotConfig). */
export const POSTS_PER_DAY_MIN = 1;
export const POSTS_PER_DAY_MAX = 6;
export const MIN_GAP_MIN = 120;
export const MIN_GAP_MAX = 480;
export const EXPLORE_RATE_MAX = 0.3;
export const PROMO_RATIO_MAX = 0.3;
/** Jendela jam tayang (jam lokal, inklusif). */
export const ACTIVE_FIRST_HOUR = 6;
export const ACTIVE_LAST_HOUR = 22;
export const BRIEF_MAX_CHARS = 600;

export interface AutopilotPillar {
  key: string;
  bobot: number;
}

/** Gaya sapaan yang bisa dipaksakan per akun; null = ikuti profil suara dari postingan akun. */
export const VOICE_STYLES = {
  gue_lo: { label: "gue / lo", hint: 'Sapaan "gue" dan "lo", santai dan akrab.' },
  saya_kamu: { label: "saya / kamu", hint: 'Sapaan "saya" dan "kamu", semi-formal dan hangat.' },
  aku_kamu: { label: "aku / kamu", hint: 'Sapaan "aku" dan "kamu", personal dan hangat.' },
  kita: { label: "kita", hint: 'Sapaan "kita", inklusif seperti komunitas.' },
} as const;
export type VoiceStyle = keyof typeof VOICE_STYLES;

export interface AutopilotSettings {
  mode: AutopilotMode;
  postsPerDay: number;
  slotStrategy: SlotStrategy;
  /** Jam lokal (0-23) untuk strategi JAM_TETAP. */
  fixedHours: number[];
  minGapMinutes: number;
  /** 0 = Minggu ... 6 = Sabtu. */
  activeDays: number[];
  exploreRate: number;
  pillars: AutopilotPillar[];
  promoRatio: number;
  voiceStyle: VoiceStyle | null;
  brief: string | null;
}

export const DEFAULT_SETTINGS: AutopilotSettings = {
  mode: "MATI",
  postsPerDay: 3,
  slotStrategy: "JAM_RAMAI",
  fixedHours: [],
  minGapMinutes: 150,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  exploreRate: 0.15,
  pillars: [],
  promoRatio: 0,
  voiceStyle: null,
  brief: null,
};

export interface AutopilotConfigDTO extends AutopilotSettings {
  accountId: string;
  /** Kode alasan jeda dari penjaga; null = berjalan. */
  pausedReason: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
}

export interface AutopilotSlotDTO {
  id: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
  /** ISO UTC */
  slotAt: string;
  hour: number;
  kind: SlotKind;
  status: SlotStatus;
  reason: string | null;
  skipReason: string | null;
  lastError: string | null;
  postId: string | null;
  attempt: number;
  criticScore: number | null;
}

export interface GateCheckDTO {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface SlotDraftDTO {
  text: string;
  topicTag: string | null;
  angle: string;
  rationale: string;
  model: string;
  chars: number;
  checks: GateCheckDTO[];
  /** Diubah manusia sebelum disetujui. */
  edited?: boolean;
  /** Ide dari bank ide yang ditulis slot ini (bila ada). */
  idea?: { id: string; topik: string };
  /** Kunci topik ide, untuk membatasi topik kembar antar-akun. */
  topicKey?: string;
  /** Slot promo (isi dari butir PROMO knowledge base). */
  promo?: boolean;
  /** Pilar konten slot ini. */
  pillar?: string;
  /** Slot affiliate: produk katalog dan balasan pertama berisi link (dikirim worker setelah terbit). */
  affiliate?: { productId: string; nama: string; link: string; replyText: string };
}

export interface AutopilotSlotDetailDTO extends AutopilotSlotDTO {
  draft: SlotDraftDTO | null;
}

export interface AutopilotAccountDTO {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  outletNama: string | null;
  ready: boolean;
  reason?: PublishReason;
  config: AutopilotConfigDTO;
  /** Kepatuhan 7 hari terakhir (hari dengan >= 3 posting terbit / hari berjalan). */
  stats7d: { hari: number; hariPatuh: number; terbit: number; gagal: number; dilewati: number } | null;
}

export interface AutopilotHealthDTO {
  /** ISO UTC tick terakhir; null bila belum pernah. */
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastRunError: string | null;
  /** Tick terakhir lebih lama dari ambang: penjadwal kemungkinan mati. */
  stale: boolean;
  counts: Record<string, number>;
}

export interface AutopilotOverviewResponse {
  success: true;
  /** Tabel autopilot sudah dibuat (sql/005_autopilot.sql). */
  installed: boolean;
  publishEnabled: boolean;
  /** Saklar "jeda semua". */
  workspaceActive: boolean;
  today: string;
  tomorrow: string;
  accounts: AutopilotAccountDTO[];
  slots: AutopilotSlotDTO[];
  reviewCount: number;
  health: AutopilotHealthDTO;
  limits: { maxPostsPerDay: number };
}

export interface SlotListResponse {
  success: true;
  items: (AutopilotSlotDetailDTO & {
    account: { username: string | null; displayName: string; avatarUrl: string | null };
  })[];
  nextCursor: string | null;
}

export interface PlanPreviewSlot {
  slotAt: string;
  hour: number;
  minute: number;
  kind: SlotKind;
  reason: string;
}

export interface PlanPreviewResponse {
  success: true;
  dayKey: string;
  slots: PlanPreviewSlot[];
  /** Asal data jam: akun sendiri, jaringan, atau belum ada data. */
  source: "account" | "network" | "none";
}

export type SlotAction = "approve" | "reject" | "rewrite" | "skip";

/** Alasan jeda dari penjaga ➜ kalimat untuk UI. */
export function pausedText(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.startsWith("AKUN_TIDAK_SIAP")) return "Dijeda: akun belum siap diposting.";
  if (reason === "GAGAL_BERUNTUN") return "Dijeda: tiga posting terakhir gagal terbit.";
  if (reason === "KINERJA_TURUN") return "Dijeda: kinerja turun tajam, periksa dulu kontennya.";
  return "Dijeda oleh sistem.";
}
