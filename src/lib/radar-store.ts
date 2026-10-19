/**
 * Akses data radar tren, bank ide, momen, dan knowledge base: pembungkus bertipe untuk fungsi RPC
 * di sql/006_autopilot_radar.sql. Tanpa logika bisnis.
 */
import { rpc, utc } from "@/lib/supabase";
import { MissingAutopilotSchemaError, isMissingAutopilotSchema, missingSchemaFile } from "./autopilot-store";
import type { SignalDraft } from "./radar-sources";
import type {
  IdeaScoreDetail,
  IdeaStatus,
  KnowledgeKind,
  SignalSource,
} from "./radar-types";

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await rpc<T>(fn, args);
  } catch (err) {
    if (isMissingAutopilotSchema(err)) throw new MissingAutopilotSchemaError(missingSchemaFile(err));
    throw err;
  }
}

const iso = (v: string): string => utc(v).toISOString();

/* ------------------------------------------------------------------ sinyal */

export interface RadarState {
  /** Pengambilan terakhir per sumber. */
  lastCapture: Partial<Record<SignalSource, Date>>;
  /** Stok ide BARU per akun. */
  ideaCounts: Map<string, number>;
  /** Riset tren niche terakhir per akun (yang sinyalnya masih berlaku); null = sql/027 belum dipasang. */
  nicheAt: Map<string, Date> | null;
}

export async function loadRadarState(now: Date): Promise<RadarState> {
  const raw = await call<{
    lastCapture: Record<string, string>;
    ideaCounts: { accountId: string; baru: number }[];
    nicheAt?: Record<string, string>;
  }>("dash_radar_state", { p_now: now });
  return {
    lastCapture: Object.fromEntries(Object.entries(raw.lastCapture).map(([k, v]) => [k, utc(v)])),
    ideaCounts: new Map(raw.ideaCounts.map((c) => [c.accountId, c.baru])),
    nicheAt: raw.nicheAt ? new Map(Object.entries(raw.nicheAt).map(([k, v]) => [k, utc(v)])) : null,
  };
}

export async function upsertSignals(items: SignalDraft[], now: Date): Promise<number> {
  if (items.length === 0) return 0;
  return call<number>("dash_radar_upsert", { p_items: items, p_now: now });
}

export const syncWinners = (now: Date) => call<number>("dash_radar_sync_winners", { p_now: now });

export const syncMoments = (now: Date, today: string) =>
  call<number>("dash_radar_sync_moments", { p_now: now, p_today: today });

export const pruneRadar = (now: Date) => call<number>("dash_radar_prune", { p_now: now });

export interface SignalRow {
  id: string;
  workspaceId: string | null;
  source: SignalSource;
  title: string;
  summary: string | null;
  url: string | null;
  rank: number | null;
  score: number;
  accountId: string | null;
  capturedAt: string;
  expiresAt: string;
  createdBy: string | null;
}

/** Sinyal aktif: global + milik workspace. Mengembalikan `limit + 1` baris bila masih ada halaman berikutnya. */
export async function listSignals(q: {
  workspaceId: string | null;
  sources: SignalSource[] | null;
  now: Date;
  cursor: { at: Date; id: string } | null;
  limit: number;
}): Promise<SignalRow[]> {
  const rows = await call<SignalRow[]>("dash_radar_signals", {
    p_workspace: q.workspaceId,
    p_sources: q.sources,
    p_now: q.now,
    p_cursor_at: q.cursor?.at ?? null,
    p_cursor_id: q.cursor?.id ?? null,
    p_limit: q.limit,
  });
  return rows.map((r) => ({ ...r, capturedAt: iso(r.capturedAt), expiresAt: iso(r.expiresAt) }));
}

/** Sinyal NICHE yang masih berlaku per akun, paling baru dulu (sql/027). */
export async function listNicheSignals(accountIds: string[], now: Date, perAccount: number): Promise<Map<string, SignalRow[]>> {
  const out = new Map<string, SignalRow[]>();
  if (accountIds.length === 0) return out;
  const rows = await call<SignalRow[]>("dash_radar_niche", { p_account_ids: accountIds, p_now: now, p_per: perAccount });
  for (const r of rows) {
    if (!r.accountId) continue;
    const row = { ...r, capturedAt: iso(r.capturedAt), expiresAt: iso(r.expiresAt) };
    out.set(r.accountId, [...(out.get(r.accountId) ?? []), row]);
  }
  return out;
}

export interface SignalBrief {
  id: string;
  source: SignalSource;
  title: string;
  summary: string | null;
  url: string | null;
}

/** Ringkasan sinyal menurut id (rujukan ide), untuk konteks tulisan dan rencana posting (sql/021). */
export async function signalBriefs(ids: string[]): Promise<Map<string, SignalBrief>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await call<SignalBrief[]>("dash_radar_signal_briefs", { p_ids: unique.slice(0, 400) });
  return new Map(rows.map((r) => [r.id, r]));
}

export interface IdeaDetail {
  id: string;
  topik: string;
  sudut: string | null;
  formulaHook: string | null;
  pilar: string | null;
  signalIds: string[];
  score: number;
  /** Potensi viral 0..1 (null pada ide lama). */
  viral: number | null;
  alasan: string | null;
}

/** Rincian ide menurut id, termasuk potensi viral dan alasan dari rincian skor (sql/021). */
export async function ideaDetails(ids: string[], workspaceId: string | null): Promise<Map<string, IdeaDetail>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await call<IdeaDetail[]>("dash_idea_details", { p_ids: unique.slice(0, 400), p_workspace: workspaceId });
  return new Map(rows.map((r) => [r.id, { ...r, signalIds: r.signalIds ?? [] }]));
}

export const deleteManualSignal = (id: string, workspaceId: string | null) =>
  call<boolean>("dash_radar_signal_delete", { p_id: id, p_workspace: workspaceId });

/* ------------------------------------------------------------------ momen */

export interface MomentRow {
  id: string;
  workspaceId: string;
  nama: string;
  mulai: string;
  selesai: string;
  catatan: string | null;
}

export const listMoments = (workspaceId: string | null, fromDay: string) =>
  call<MomentRow[]>("dash_moment_list", { p_workspace: workspaceId, p_from: fromDay });

export const upsertMoment = (
  item: { id?: string; workspaceId: string; nama: string; mulai: string; selesai: string; catatan: string | null },
  userId: string,
  now: Date
) => call<string | null>("dash_moment_upsert", { p_item: item, p_user: userId, p_now: now });

export const deleteMoment = (id: string, workspaceId: string | null) =>
  call<boolean>("dash_moment_delete", { p_id: id, p_workspace: workspaceId });

/* ------------------------------------------------------------------ ide */

export interface IdeaContext {
  /** Potongan postingan terakhir per akun. */
  recents: Map<string, string[]>;
  /** Kunci topik ide yang masih hidup (BARU atau baru saja DIPAKAI) per akun. */
  topics: Map<string, string[]>;
}

export async function loadIdeaContext(accountIds: string[], now: Date): Promise<IdeaContext> {
  const raw = await call<{ recents: { aid: string; text: string }[]; ideas: { aid: string; topicKey: string }[] }>(
    "dash_idea_context",
    { p_ids: accountIds, p_now: now }
  );
  const recents = new Map<string, string[]>();
  for (const r of raw.recents) recents.set(r.aid, [...(recents.get(r.aid) ?? []), r.text]);
  const topics = new Map<string, string[]>();
  for (const i of raw.ideas) topics.set(i.aid, [...(topics.get(i.aid) ?? []), i.topicKey]);
  return { recents, topics };
}

export interface IdeaWrite {
  id: string;
  workspaceId: string;
  accountId: string;
  topik: string;
  topicKey: string;
  sudut: string | null;
  formulaHook: string | null;
  pilar: string | null;
  signalIds: string[];
  score: number;
  scoreDetail: IdeaScoreDetail;
  /** ISO UTC */
  expiresAt: string;
}

export async function insertIdeas(items: IdeaWrite[], now: Date): Promise<number> {
  if (items.length === 0) return 0;
  return call<number>("dash_idea_insert", { p_items: items, p_now: now });
}

/**
 * Pensiunkan ide BARU satu akun yang dibuat sebelum `before`, tidak disematkan, dan tidak menumpang tren
 * niche (sql/028). Mengembalikan jumlah ide yang dipensiunkan.
 */
export const retireStaleIdeas = (accountId: string, before: Date, now: Date) =>
  call<number>("dash_idea_retire_stale", { p_account_id: accountId, p_before: before, p_now: now });

export interface IdeaCandidate {
  id: string;
  accountId: string;
  topik: string;
  topicKey: string;
  sudut: string | null;
  formulaHook: string | null;
  pilar: string | null;
  signalIds: string[];
  score: number;
  pinned: boolean;
}

/** Ide BARU terbaik untuk banyak akun sekaligus (disematkan dulu, lalu skor). */
export async function ideaCandidates(accountIds: string[], now: Date, perAccount: number): Promise<Map<string, IdeaCandidate[]>> {
  const rows = await call<IdeaCandidate[]>("dash_idea_candidates", { p_ids: accountIds, p_now: now, p_per: perAccount });
  const out = new Map<string, IdeaCandidate[]>();
  for (const r of rows) out.set(r.accountId, [...(out.get(r.accountId) ?? []), r]);
  return out;
}

export interface IdeaRow {
  id: string;
  accountId: string;
  topik: string;
  sudut: string | null;
  formulaHook: string | null;
  pilar: string | null;
  score: number;
  scoreDetail: Partial<IdeaScoreDetail>;
  status: IdeaStatus;
  pinned: boolean;
  usedBySlot: string | null;
  expiresAt: string;
  createdAt: string;
  signals: { id: string; source: SignalSource; title: string }[];
}

export async function listIdeas(q: {
  workspaceId: string | null;
  accountIds: string[] | null;
  statuses: IdeaStatus[];
  cursor: { at: Date; id: string } | null;
  limit: number;
}): Promise<IdeaRow[]> {
  const rows = await call<IdeaRow[]>("dash_idea_list", {
    p_workspace: q.workspaceId,
    p_account_ids: q.accountIds,
    p_statuses: q.statuses,
    p_cursor_at: q.cursor?.at ?? null,
    p_cursor_id: q.cursor?.id ?? null,
    p_limit: q.limit,
  });
  return rows.map((r) => ({ ...r, expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt) }));
}

/** Ubah ide secara bersyarat (status asal harus ada di `from`, dan ide berada dalam lingkup pengguna). */
export const updateIdea = (
  id: string,
  t: {
    workspaceId?: string | null;
    accountIds?: string[] | null;
    from: IdeaStatus[];
    patch: { status?: IdeaStatus; pinned?: boolean; usedBySlot?: string; actor?: string };
  },
  now: Date
) =>
  call<boolean>("dash_idea_update", {
    p_id: id,
    p_workspace: t.workspaceId ?? null,
    p_account_ids: t.accountIds ?? null,
    p_from: t.from,
    p_patch: t.patch,
    p_now: now,
  });

/* ------------------------------------------------------------------ knowledge base */

export interface KnowledgeRow {
  id: string;
  workspaceId: string;
  accountId: string | null;
  jenis: KnowledgeKind;
  judul: string;
  isi: string;
  berlakuSampai: string | null;
  updatedAt: string;
}

export async function listKnowledge(workspaceId: string | null, accountIds: string[] | null): Promise<KnowledgeRow[]> {
  const rows = await call<KnowledgeRow[]>("dash_kb_list", { p_workspace: workspaceId, p_account_ids: accountIds });
  return rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) }));
}

export interface ActiveKnowledge {
  workspaceId: string;
  accountId: string | null;
  jenis: KnowledgeKind;
  judul: string;
  isi: string;
}

/** Butir yang berlaku hari ini untuk akun-akun tertentu (butir workspace + butir akun). */
export const activeKnowledge = (accountIds: string[], today: string) =>
  call<ActiveKnowledge[]>("dash_kb_active", { p_ids: accountIds, p_today: today });

export const upsertKnowledge = (
  item: {
    id?: string;
    workspaceId: string;
    accountId: string | null;
    jenis: KnowledgeKind;
    judul: string;
    isi: string;
    berlakuSampai: string | null;
  },
  /** Lingkup akun pengguna (null = semua): butir di luar lingkup tidak bisa diubah. */
  accountIds: string[] | null,
  userId: string,
  now: Date
) => call<string | null>("dash_kb_upsert", { p_item: item, p_account_ids: accountIds, p_user: userId, p_now: now });

export const deleteKnowledge = (id: string, workspaceId: string | null, accountIds: string[] | null, userId: string, now: Date) =>
  call<boolean>("dash_kb_delete", { p_id: id, p_workspace: workspaceId, p_account_ids: accountIds, p_user: userId, p_now: now });
