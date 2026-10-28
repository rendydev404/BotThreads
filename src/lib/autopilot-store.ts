/**
 * Akses data autopilot: pembungkus bertipe untuk fungsi RPC `dash_ap_*` (sql/005_autopilot.sql).
 * Semua agregasi, klaim baris (FOR UPDATE SKIP LOCKED), dan transisi status bersyarat dikerjakan di
 * database; modul ini hanya memetakan bentuk baris. Tidak ada logika bisnis di sini.
 */
import { rpc, utc } from "@/lib/supabase";
import {
  DEFAULT_SETTINGS,
  type AutopilotConfigDTO,
  type AutopilotMode,
  type AutopilotPillar,
  type AutopilotSettings,
  type AutopilotSlotDTO,
  type MediaMode,
  type SlotDraftDTO,
  type SlotKind,
  type SlotStatus,
  type SlotStrategy,
  type VoiceStyle,
} from "./autopilot-types";

/** Pelaku untuk audit dan log posting saat autopilot bertindak tanpa manusia. */
export const SYSTEM_ACTOR = "system:autopilot";

/** Tabel/fungsi dashboard belum dibuat; `file` = berkas SQL yang perlu dijalankan (sql/005 sampai sql/008). */
export class MissingAutopilotSchemaError extends Error {
  readonly file: string;
  constructor(file = "sql/005_autopilot.sql") {
    super(`Skema belum ada. Jalankan ${file}.`);
    this.name = "MissingAutopilotSchemaError";
    this.file = file;
  }
}

/** Berkas SQL yang memuat objek (fungsi/tabel) yang disebut pesan galat "tidak ada"; bawaan sql/005. */
export function missingSchemaFile(err: unknown): string {
  if (err instanceof MissingAutopilotSchemaError) return err.file;
  const msg = err instanceof Error ? err.message : "";
  if (/dash_acmt_|BtAutoComment/.test(msg)) return "sql/043_auto_comment.sql";
  if (/dash_reply_|ThreadsComment|ThreadsReply(?:Setting|Watch)/.test(msg)) return "sql/023_threads_replies.sql";
  if (/dash_aff_|Affiliate(?:Product|Config|Workspace|Use)/.test(msg)) return "sql/019_affiliate.sql";
  if (/dash_sa_|Platform(?:Settings|AuditLog)/.test(msg)) return "sql/010_superadmin.sql";
  if (/dash_mu_signup/.test(msg)) return "sql/009_signup.sql";
  if (/dash_mu_|DashboardMembership|DashboardMemberAccount|DashboardInvite|DashboardPasswordReset/.test(msg)) return "sql/008_multiuser.sql";
  if (/dash_(?:learn|notif)_|ContentOutcome|DashboardNotification/.test(msg)) return "sql/007_autopilot_learning.sql";
  if (/dash_(?:pub_)?media_tmp/.test(msg)) return "sql/040_media_tmp.sql";
  if (/dash_media_policy/.test(msg)) return "sql/039_media_policy.sql";
  if (/dash_idea_media_set/.test(msg)) return "sql/038_idea_media.sql";
  if (/dash_learn_label_/.test(msg)) return "sql/042_learning_format.sql";
  if (/dash_style_|StyleExample/.test(msg)) return "sql/041_style_corpus.sql";
  if (/dash_idea_retire_stale/.test(msg)) return "sql/028_idea_retire_stale.sql";
  if (/dash_radar_niche/.test(msg)) return "sql/027_radar_niche_trends.sql";
  if (/dash_ap_claim_account|dash_style_lesson_add|AccountStyleLesson|AccountOnboarding/.test(msg)) return "sql/031_account_ai_brain.sql";
  if (/dash_ap_plan_drafts|dash_radar_signal_briefs|dash_idea_details/.test(msg)) return "sql/021_autopilot_plan_view.sql";
  if (/dash_(?:radar|idea|kb|moment)_|TrendSignal|ContentIdea|KnowledgeBase|ContentMoment/.test(msg)) return "sql/006_autopilot_radar.sql";
  return "sql/005_autopilot.sql";
}

export function isMissingAutopilotSchema(err: unknown): boolean {
  if (err instanceof MissingAutopilotSchemaError) return true;
  const msg = err instanceof Error ? err.message : "";
  // PGRST202 = fungsi tidak ada di cache skema PostgREST; 42883/42P01 = fungsi/tabel tidak ada.
  return (
    /PGRST202|42883|42P01/.test(msg) &&
    /dash_(?:ap|radar|idea|kb|moment|learn|notif|mu|aff|reply|acmt)_|BtAutoComment|Autopilot|Affiliate|ThreadsComment|ThreadsReply|WorkspaceSettings|DashboardAuditLog|TrendSignal|ContentIdea|KnowledgeBase|ContentMoment|ContentOutcome|DashboardNotification|DashboardMembership|DashboardInvite/.test(
      msg
    )
  );
}

/** Jalankan RPC autopilot; skema yang belum dipasang dilempar sebagai galat khusus. */
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

/* ------------------------------------------------------------------ bentuk baris */

interface RawConfig {
  accountId: string;
  workspaceId: string;
  mode: AutopilotMode;
  postsPerDay: number;
  slotStrategy: SlotStrategy;
  fixedHours: number[] | null;
  minGapMinutes: number;
  activeDays: number[] | null;
  exploreRate: number;
  pillars: AutopilotPillar[] | null;
  promoRatio: number;
  voiceStyle: string | null;
  brief: string | null;
  /** Kolom sql/039; tidak ada bila berkas itu belum dijalankan (dipakai nilai bawaan). */
  mediaMode?: MediaMode | null;
  mediaMaxPersen?: number | null;
  pausedReason: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
}

export interface ConfigRow extends AutopilotConfigDTO {
  workspaceId: string;
}

interface RawSlot {
  id: string;
  workspaceId: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
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
  draft?: SlotDraftDTO | null;
}

export interface SlotRow extends AutopilotSlotDTO {
  workspaceId: string;
  draft: SlotDraftDTO | null;
}

const iso = (v: string | null): string | null => (v ? utc(v).toISOString() : null);

const toConfig = (r: RawConfig): ConfigRow => ({
  accountId: r.accountId,
  workspaceId: r.workspaceId,
  mode: r.mode,
  postsPerDay: r.postsPerDay,
  slotStrategy: r.slotStrategy,
  fixedHours: r.fixedHours ?? [],
  minGapMinutes: r.minGapMinutes,
  activeDays: r.activeDays ?? [],
  exploreRate: r.exploreRate,
  pillars: Array.isArray(r.pillars) ? r.pillars : [],
  promoRatio: r.promoRatio,
  voiceStyle: (r.voiceStyle as VoiceStyle | null) ?? null,
  brief: r.brief,
  mediaMode: r.mediaMode === "MATI" || r.mediaMode === "OTOMATIS" ? r.mediaMode : DEFAULT_SETTINGS.mediaMode,
  mediaMaxPersen: typeof r.mediaMaxPersen === "number" ? r.mediaMaxPersen : DEFAULT_SETTINGS.mediaMaxPersen,
  pausedReason: r.pausedReason,
  pausedAt: iso(r.pausedAt),
  updatedAt: iso(r.updatedAt),
});

const toSlot = (r: RawSlot): SlotRow => ({
  id: r.id,
  workspaceId: r.workspaceId,
  accountId: r.accountId,
  dayKey: r.dayKey,
  slotIndex: r.slotIndex,
  slotAt: utc(r.slotAt).toISOString(),
  hour: r.hour,
  kind: r.kind,
  status: r.status,
  reason: r.reason,
  skipReason: r.skipReason,
  lastError: r.lastError,
  postId: r.postId,
  attempt: r.attempt,
  criticScore: r.criticScore,
  draft: r.draft ?? null,
});

/** Konfigurasi bawaan untuk akun yang belum pernah diatur. */
export const defaultConfig = (accountId: string): AutopilotConfigDTO => ({
  ...DEFAULT_SETTINGS,
  accountId,
  pausedReason: null,
  pausedAt: null,
  updatedAt: null,
});

/* ------------------------------------------------------------------ baca */

export interface RunRow {
  startedAt: string;
  finishedAt: string;
  durasiMs: number;
  hitung: Record<string, number>;
  error: string | null;
}

export interface Stats7d {
  hari: number;
  hariPatuh: number;
  terbit: number;
  gagal: number;
  dilewati: number;
}

export interface AutopilotState {
  /** workspaceId -> saklar autopilot (yang tidak tercatat dianggap aktif). */
  workspaceActive: Map<string, boolean>;
  configs: Map<string, ConfigRow>;
  /** Slot rentang hari yang diminta, tanpa teks draf. */
  slots: SlotRow[];
  lastRun: RunRow | null;
  stats7d: Map<string, Stats7d>;
}

/** Keadaan autopilot dalam satu RPC. `workspaceId` null = semua workspace (hanya untuk tick). */
export async function loadState(workspaceId: string | null, fromDay: string, toDay: string): Promise<AutopilotState> {
  const raw = await call<{
    settings: { workspaceId: string; autopilotAktif: boolean }[];
    configs: RawConfig[];
    slots: RawSlot[];
    lastRun: (Omit<RunRow, "startedAt" | "finishedAt"> & { startedAt: string; finishedAt: string }) | null;
    stats7d: (Stats7d & { accountId: string })[];
  }>("dash_ap_state", { p_workspace: workspaceId, p_from: fromDay, p_to: toDay });
  return {
    workspaceActive: new Map(raw.settings.map((s) => [s.workspaceId, s.autopilotAktif])),
    configs: new Map(raw.configs.map((c) => [c.accountId, toConfig(c)])),
    slots: raw.slots.map(toSlot),
    lastRun: raw.lastRun
      ? {
          ...raw.lastRun,
          startedAt: utc(raw.lastRun.startedAt).toISOString(),
          finishedAt: utc(raw.lastRun.finishedAt).toISOString(),
        }
      : null,
    stats7d: new Map(raw.stats7d.map(({ accountId, ...rest }) => [accountId, rest])),
  };
}

export interface SlotListQuery {
  workspaceId: string | null;
  accountIds: string[] | null;
  statuses: SlotStatus[];
  cursor: { at: Date; id: string } | null;
  desc: boolean;
  limit: number;
}

/** Slot lengkap dengan draf; mengembalikan `limit + 1` baris bila masih ada halaman berikutnya. */
export async function listSlots(q: SlotListQuery): Promise<SlotRow[]> {
  const rows = await call<RawSlot[]>("dash_ap_slot_list", {
    p_workspace: q.workspaceId,
    p_account_ids: q.accountIds,
    p_statuses: q.statuses,
    p_cursor_at: q.cursor?.at ?? null,
    p_cursor_id: q.cursor?.id ?? null,
    p_desc: q.desc,
    p_limit: q.limit,
  });
  return rows.map(toSlot);
}

export async function getSlot(id: string, workspaceId: string | null): Promise<SlotRow | null> {
  const row = await call<RawSlot | null>("dash_ap_slot_get", { p_id: id, p_workspace: workspaceId });
  return row ? toSlot(row) : null;
}

export interface PlanDraftRow {
  id: string;
  ideaId: string | null;
  text: string | null;
  angle: string | null;
  pillar: string | null;
  promo: boolean;
  topik: string | null;
  topicKey: string | null;
  /** Nama produk affiliate slot ini. */
  affiliate: string | null;
}

/** Draf slot satu hari untuk rencana posting, hanya kolom yang ditampilkan (sql/021). */
export async function planDrafts(workspaceId: string | null, dayKey: string, accountIds: string[]): Promise<PlanDraftRow[]> {
  if (accountIds.length === 0) return [];
  return call<PlanDraftRow[]>("dash_ap_plan_drafts", { p_workspace: workspaceId, p_day: dayKey, p_account_ids: accountIds });
}

/** Draf autopilot yang sudah jadi pada rentang hari (pembanding antar-akun). */
export const peerTexts = (workspaceId: string | null, fromDay: string, toDay: string) =>
  call<{ aid: string; text: string | null; topicKey: string | null }[]>("dash_ap_peer_texts", {
    p_workspace: workspaceId,
    p_from: fromDay,
    p_to: toDay,
  });

/** Id posting (dari daftar) yang dibuat autopilot. */
export async function autopilotPostIds(postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  return new Set(await call<string[]>("dash_ap_post_flags", { p_ids: postIds }));
}

export async function listRuns(limit: number): Promise<(RunRow & { id: string })[]> {
  const rows = await call<(RunRow & { id: string })[]>("dash_ap_runs", { p_limit: limit });
  return rows.map((r) => ({
    ...r,
    startedAt: utc(r.startedAt).toISOString(),
    finishedAt: utc(r.finishedAt).toISOString(),
  }));
}

/* ------------------------------------------------------------------ tulis: konfigurasi */

export interface ConfigWrite extends AutopilotSettings {
  accountId: string;
  workspaceId: string;
}

/** Simpan pengaturan banyak akun sekaligus (satu transaksi + audit); slot yang belum dikerjakan direncanakan ulang. */
export const upsertConfigs = (items: ConfigWrite[], userId: string, now: Date) =>
  call<number>("dash_ap_config_upsert", { p_items: items, p_user: userId, p_now: now });

export const setWorkspaceActive = (workspaceId: string, active: boolean, userId: string, now: Date) =>
  call<boolean>("dash_ap_workspace_set", { p_workspace: workspaceId, p_aktif: active, p_user: userId, p_now: now });

/** Jeda akun oleh penjaga; mengembalikan id akun yang baru dijeda. */
export const pauseAccounts = (accountIds: string[], reason: string, now: Date) =>
  call<string[]>("dash_ap_pause", { p_ids: accountIds, p_reason: reason, p_now: now });

/** Lanjutkan akun yang dijeda dengan alasan berawalan `prefix`; mengembalikan id yang dilanjutkan. */
export const resumeAccounts = (accountIds: string[], prefix: string, now: Date) =>
  call<string[]>("dash_ap_resume", { p_ids: accountIds, p_prefix: prefix, p_now: now });

/* ------------------------------------------------------------------ tulis: slot */

export interface PlannedSlotWrite {
  id: string;
  workspaceId: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
  slotAt: string;
  hour: number;
  kind: SlotKind;
  reason: string;
}

/** Sisipkan slot rencana; slot (akun, hari, urut) yang sudah ada dibiarkan. Mengembalikan jumlah baris baru. */
export async function insertPlannedSlots(items: PlannedSlotWrite[], now: Date): Promise<number> {
  if (items.length === 0) return 0;
  return call<number>("dash_ap_plan_slots", { p_items: items, p_now: now });
}

export interface ClaimedSlot {
  id: string;
  workspaceId: string;
  accountId: string;
  dayKey: string;
  slotIndex: number;
  slotAt: Date;
  hour: number;
  kind: SlotKind;
  reason: string | null;
  attempt: number;
  ideaId: string | null;
  mode: AutopilotMode;
  /** Teks draf sebelumnya (diminta tulis ulang) yang harus dihindari. */
  prevText: string | null;
}

export interface ClaimWindow {
  now: Date;
  /** Slot lebih awal dari ini tidak lagi sempat diantre. */
  minAt: Date;
  /** Batas depan untuk mode otomatis (tulis menjelang tayang) dan mode tinjau (beri waktu manusia). */
  untilAuto: Date;
  untilReview: Date;
  leaseUntil: Date;
  limit: number;
}

/** Ambil dan kunci slot yang sudah waktunya ditulis (aman dipanggil serentak). */
export async function claimSlots(w: ClaimWindow): Promise<ClaimedSlot[]> {
  const rows = await call<(Omit<ClaimedSlot, "slotAt"> & { slotAt: string })[]>("dash_ap_claim", {
    p_now: w.now,
    p_min_at: w.minAt,
    p_until_auto: w.untilAuto,
    p_until_review: w.untilReview,
    p_lease_until: w.leaseUntil,
    p_limit: w.limit,
  });
  return rows.map((r) => ({ ...r, slotAt: utc(r.slotAt), prevText: r.prevText ?? null }));
}

export interface SlotPatch {
  draft?: SlotDraftDTO | null;
  criticScore?: number | null;
  postId?: string | null;
  ideaId?: string | null;
  /** ISO UTC */
  slotAt?: string;
  skipReason?: string | null;
  lastError?: string | null;
  /** Koreksi hitungan percobaan (mis. -1 saat slot dilepas tanpa sempat dikerjakan). */
  attemptDelta?: number;
  /** ISO UTC: kunci sementara (status MENULIS) selama manusia menyetujui draf. */
  leaseUntil?: string;
  /** Catat ke audit: pelaku dan nama tindakan. */
  actor?: string;
  auditAction?: string;
}

/**
 * Transisi status bersyarat dan atomik: berhasil hanya bila status slot saat ini ada di `from`
 * (dan slot milik `workspaceId` bila diisi). False berarti slot sudah berubah oleh pihak lain.
 */
export const updateSlot = (
  id: string,
  t: { workspaceId?: string | null; from: SlotStatus[]; to: SlotStatus; patch?: SlotPatch },
  now: Date
) =>
  call<boolean>("dash_ap_slot_update", {
    p_id: id,
    p_workspace: t.workspaceId ?? null,
    p_from: t.from,
    p_status: t.to,
    p_patch: t.patch ?? {},
    p_now: now,
  });

export interface ReconcileResult {
  terbit: number;
  gagal: number;
  dibatalkan: number;
  diulang: number;
  tinjauLewat: number;
  terlambat: number;
  /** Akun yang tiga slot terakhirnya gagal terbit. */
  gagalBeruntun: string[];
  /** Posting autopilot yang lewat jadwal tetapi belum diambil penerbit. */
  penerbitTelat: number;
}

export const reconcile = (now: Date, reviewCutoff: Date, staleBefore: Date, lateBefore: Date) =>
  call<ReconcileResult>("dash_ap_reconcile", {
    p_now: now,
    p_review_cutoff: reviewCutoff,
    p_stale_before: staleBefore,
    p_late_before: lateBefore,
  });

/* ------------------------------------------------------------------ tulis: tick */

export const acquireLease = (name: string, holder: string, now: Date, until: Date) =>
  call<boolean>("dash_ap_lease", { p_name: name, p_holder: holder, p_now: now, p_until: until });

export const releaseLease = (name: string, holder: string) => call<boolean>("dash_ap_release", { p_name: name, p_holder: holder });

export interface ClaimAccountWindow {
  accountId: string;
  now: Date;
  minAt: Date;
  until: Date;
  leaseUntil: Date;
  limit: number;
}

/** Klaim slot jatuh tempo untuk satu akun saja (dipakai agen onboarding untuk draf pertama hari ini). */
export async function claimAccountSlots(w: ClaimAccountWindow): Promise<ClaimedSlot[]> {
  const rows = await call<(Omit<ClaimedSlot, "slotAt"> & { slotAt: string })[]>("dash_ap_claim_account", {
    p_account_id: w.accountId,
    p_now: w.now,
    p_min_at: w.minAt,
    p_until: w.until,
    p_lease_until: w.leaseUntil,
    p_limit: w.limit,
  });
  return rows.map((r) => ({ ...r, slotAt: utc(r.slotAt), prevText: r.prevText ?? null }));
}


export const logRun = (run: { startedAt: Date; finishedAt: Date; durasiMs: number; hitung: Record<string, number>; error?: string }) =>
  call<boolean>("dash_ap_run_log", { p_run: run });
