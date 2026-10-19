/**
 * Layanan radar tren, bank ide, momen kalender, dan knowledge base untuk route API. Semua fungsi
 * menerima konteks pengguna dan hanya menyentuh data dalam lingkupnya.
 */
import { extraBannedTerms } from "./autopilot-config";
import { DEFAULT_BANNED_TERMS, bannedHits } from "./autopilot-gate";
import { hash32 } from "./autopilot-plan";
import { visibleAccounts } from "./autopilot-service";
import { MissingAutopilotSchemaError } from "./autopilot-store";
import { cleanExternal } from "./radar-sources";
import {
  deleteKnowledge,
  deleteManualSignal,
  deleteMoment,
  listIdeas,
  listKnowledge,
  listMoments,
  listSignals,
  loadRadarState,
  updateIdea,
  upsertKnowledge,
  upsertMoment,
  upsertSignals,
} from "./radar-store";
import {
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_TITLE_MAX,
  MANUAL_SIGNAL_MAX,
  MOMENT_MAX_SPAN_DAYS,
  MOMENT_NAME_MAX,
  MOMENT_NOTE_MAX,
  type IdeaAction,
  type IdeaListResponse,
  type IdeaStatus,
  type KnowledgeDTO,
  type KnowledgeKind,
  type KnowledgeListResponse,
  type MomentDTO,
  type MomentListResponse,
  type SignalListResponse,
  type SignalSource,
} from "./radar-types";
import { canAccessAccount, type RequestCtx } from "./request-ctx";
import { wibDayKey } from "./scheduling";
import { decodeCursor, encodeCursor, type Failure } from "./threads-publish";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RADAR_PAGE_SIZE = 20;
const MANUAL_TTL_MS = 14 * DAY_MS;

const failure = (status: number, error: string): Failure => ({ ok: false, status, error });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));

/** Jalankan pembacaan; bila skema radar belum dipasang, kembalikan `fallback` dengan `installed: false`. */
async function orNotInstalled<T extends { installed: boolean }>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MissingAutopilotSchemaError) return fallback;
    throw err;
  }
}

/**
 * Workspace tempat data baru disimpan: workspace aktif pengguna, atau satu-satunya workspace dari akun
 * yang terlihat. Null bila tidak bisa ditentukan (belum ada akun yang dipetakan, atau lebih dari satu).
 */
export async function resolveWorkspace(ctx: RequestCtx): Promise<string | null> {
  if (ctx.workspaceId) return ctx.workspaceId;
  const ids = new Set((await visibleAccounts(ctx)).map((a) => a.tenantId).filter((w): w is string => !!w));
  return ids.size === 1 ? [...ids][0] : null;
}

const NO_WORKSPACE = "Workspace belum bisa ditentukan. Pastikan ada akun yang sudah dipetakan ke cabang.";

/* ------------------------------------------------------------------ sinyal */

const SOURCES: SignalSource[] = ["NICHE", "JARINGAN", "GTRENDS", "WEB", "THREADS_SEARCH", "MOMEN", "MANUAL"];
export const isSignalSource = (v: string): v is SignalSource => (SOURCES as string[]).includes(v);

export async function listSignalPage(
  ctx: RequestCtx,
  opts: { source: SignalSource | null; cursor: string | null },
  now = new Date()
): Promise<SignalListResponse> {
  const empty: SignalListResponse = { success: true, installed: false, items: [], nextCursor: null, lastCapture: {} };
  return orNotInstalled<SignalListResponse>(async () => {
    const [rows, state] = await Promise.all([
      listSignals({
        workspaceId: ctx.workspaceId,
        sources: opts.source ? [opts.source] : null,
        now,
        cursor: decodeCursor(opts.cursor),
        limit: RADAR_PAGE_SIZE,
      }),
      // Info "terakhir diambil" hanya perlu di halaman pertama.
      opts.cursor ? Promise.resolve(null) : loadRadarState(now),
    ]);
    const page = rows.slice(0, RADAR_PAGE_SIZE);
    const last = page.at(-1);
    // Tren niche milik akun yang tidak dikelola pengguna berlingkup akun tidak ditampilkan.
    const visible = page.filter((s) => s.source !== "NICHE" || (!!s.accountId && canAccessAccount(ctx, s.accountId)));
    return {
      success: true,
      installed: true,
      items: visible.map((s) => ({
        id: s.id,
        source: s.source,
        title: s.title,
        summary: s.summary,
        url: s.url,
        rank: s.rank,
        score: s.score,
        accountId: s.accountId,
        capturedAt: s.capturedAt,
        expiresAt: s.expiresAt,
        removable: s.source === "MANUAL" && s.workspaceId !== null,
      })),
      nextCursor: rows.length > RADAR_PAGE_SIZE && last ? encodeCursor(new Date(last.capturedAt), last.id) : null,
      lastCapture: state
        ? Object.fromEntries(Object.entries(state.lastCapture).map(([k, v]) => [k, (v as Date).toISOString()]))
        : {},
    };
  }, empty);
}

/** Simpan inspirasi yang ditempel pengguna (teks dan/atau tautan) sebagai sinyal milik workspace. */
export async function addManualSignal(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true } | Failure> {
  if (!isRecord(body) || typeof body.text !== "string") return failure(400, "Teks inspirasi tidak valid.");
  if (body.text.length > MANUAL_SIGNAL_MAX * 3) return failure(400, `Teks inspirasi maksimal ${MANUAL_SIGNAL_MAX} karakter.`);
  const text = cleanExternal(body.text, MANUAL_SIGNAL_MAX);
  if (text.length < 10) return failure(400, "Teks inspirasi terlalu pendek (minimal 10 karakter).");

  let url: string | null = null;
  if (body.url !== undefined && body.url !== null && body.url !== "") {
    if (typeof body.url !== "string" || body.url.length > 500) return failure(400, "Tautan tidak valid.");
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protokol");
      url = parsed.toString();
    } catch {
      return failure(400, "Tautan tidak valid.");
    }
  }
  const banned = bannedHits(text, [...DEFAULT_BANNED_TERMS, ...extraBannedTerms()]);
  if (banned.length) return failure(400, `Inspirasi memuat topik yang tidak boleh dipakai: ${banned.join(", ")}.`);

  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  await upsertSignals(
    [
      {
        workspaceId,
        source: "MANUAL",
        title: text.slice(0, 280),
        summary: text.length > 280 ? text : null,
        url,
        score: 0.7,
        hash: `MANUAL:${workspaceId}:${hash32(text.toLowerCase())}`,
        expiresAt: new Date(now.getTime() + MANUAL_TTL_MS).toISOString(),
        createdBy: ctx.userId,
      },
    ],
    now
  );
  return { ok: true };
}

export async function removeManualSignal(ctx: RequestCtx, id: string): Promise<{ ok: true } | Failure> {
  // Tanpa workspace aktif, lingkupnya workspace yang terlihat pengguna (bukan semua workspace).
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  return (await deleteManualSignal(id, workspaceId)) ? { ok: true } : failure(404, "Inspirasi tidak ditemukan.");
}

/* ------------------------------------------------------------------ momen */

export async function listMomentPage(ctx: RequestCtx, now = new Date()): Promise<MomentListResponse> {
  return orNotInstalled<MomentListResponse>(async () => {
    const workspaceId = await resolveWorkspace(ctx);
    const rows = workspaceId ? await listMoments(workspaceId, wibDayKey(now)) : [];
    return {
      success: true,
      installed: true,
      items: rows.map((m) => ({ id: m.id, nama: m.nama, mulai: m.mulai, selesai: m.selesai, catatan: m.catatan })),
    };
  }, { success: true, installed: false, items: [] });
}

export async function saveMoment(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true; moment: MomentDTO } | Failure> {
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  const nama = typeof body.nama === "string" ? body.nama.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (nama.length < 2 || nama.length > MOMENT_NAME_MAX) return failure(400, `Nama momen harus 2-${MOMENT_NAME_MAX} karakter.`);
  if (!isDay(body.mulai) || !isDay(body.selesai)) return failure(400, "Tanggal momen tidak valid.");
  const span = (Date.parse(`${body.selesai}T00:00:00Z`) - Date.parse(`${body.mulai}T00:00:00Z`)) / DAY_MS;
  if (span < 0) return failure(400, "Tanggal selesai tidak boleh sebelum tanggal mulai.");
  if (span > MOMENT_MAX_SPAN_DAYS) return failure(400, `Rentang momen paling lama ${MOMENT_MAX_SPAN_DAYS} hari.`);
  if (body.selesai < wibDayKey(now)) return failure(400, "Momen sudah lewat.");
  let catatan: string | null = null;
  if (body.catatan !== undefined && body.catatan !== null) {
    if (typeof body.catatan !== "string") return failure(400, "Catatan tidak valid.");
    catatan = cleanExternal(body.catatan, MOMENT_NOTE_MAX) || null;
  }
  const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.id) ? body.id : undefined;

  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  const saved = await upsertMoment({ id, workspaceId, nama, mulai: body.mulai, selesai: body.selesai, catatan }, ctx.userId, now);
  return saved
    ? { ok: true, moment: { id: saved, nama, mulai: body.mulai, selesai: body.selesai, catatan } }
    : failure(404, "Momen tidak ditemukan.");
}

export async function removeMoment(ctx: RequestCtx, id: string): Promise<{ ok: true } | Failure> {
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  return (await deleteMoment(id, workspaceId)) ? { ok: true } : failure(404, "Momen tidak ditemukan.");
}

/* ------------------------------------------------------------------ ide */

const IDEA_VIEWS: Record<"ready" | "used" | "dropped", IdeaStatus[]> = {
  ready: ["BARU"],
  used: ["DIPAKAI"],
  dropped: ["DITOLAK", "KEDALUWARSA"],
};
export type IdeaView = keyof typeof IDEA_VIEWS;
export const isIdeaView = (v: string): v is IdeaView => v in IDEA_VIEWS;

export async function listIdeaPage(
  ctx: RequestCtx,
  opts: { view: IdeaView; accountId: string | null; cursor: string | null }
): Promise<IdeaListResponse | Failure> {
  const accounts = await visibleAccounts(ctx);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (opts.accountId && !byId.has(opts.accountId)) return failure(404, "Akun Threads tidak ditemukan.");
  return orNotInstalled<IdeaListResponse>(async () => {
    const rows = await listIdeas({
      workspaceId: ctx.workspaceId,
      accountIds: opts.accountId ? [opts.accountId] : ctx.accountIds,
      statuses: IDEA_VIEWS[opts.view],
      cursor: decodeCursor(opts.cursor),
      limit: RADAR_PAGE_SIZE,
    });
    const page = rows.slice(0, RADAR_PAGE_SIZE);
    const last = page.at(-1);
    return {
      success: true,
      installed: true,
      items: page
        .filter((i) => byId.has(i.accountId))
        .map((i) => {
          const a = byId.get(i.accountId)!;
          return { ...i, account: { username: a.username, displayName: a.displayName } };
        }),
      nextCursor: rows.length > RADAR_PAGE_SIZE && last ? encodeCursor(new Date(last.createdAt), last.id) : null,
    };
  }, { success: true, installed: false, items: [], nextCursor: null });
}

/** Sematkan (dipakai di slot berikutnya), lepas sematan, atau tolak ide yang masih siap dipakai. */
export async function actOnIdea(ctx: RequestCtx, id: string, action: IdeaAction, now = new Date()): Promise<{ ok: true } | Failure> {
  const patch =
    action === "pin"
      ? { pinned: true, actor: ctx.userId }
      : action === "unpin"
        ? { pinned: false }
        : { status: "DITOLAK" as const };
  const done = await updateIdea(id, { workspaceId: ctx.workspaceId, accountIds: ctx.accountIds, from: ["BARU"], patch }, now);
  return done ? { ok: true } : failure(409, "Ide ini sudah dipakai atau tidak tersedia lagi. Muat ulang daftar.");
}

/* ------------------------------------------------------------------ knowledge base */

const KINDS: KnowledgeKind[] = ["FAKTA", "PRODUK", "PROMO", "LARANGAN"];

export async function listKnowledgePage(ctx: RequestCtx): Promise<KnowledgeListResponse> {
  return orNotInstalled<KnowledgeListResponse>(async () => {
    const workspaceId = await resolveWorkspace(ctx);
    const rows = workspaceId ? await listKnowledge(workspaceId, ctx.accountIds) : [];
    return {
      success: true,
      installed: true,
      items: rows.map((k) => ({
        id: k.id,
        accountId: k.accountId,
        jenis: k.jenis,
        judul: k.judul,
        isi: k.isi,
        berlakuSampai: k.berlakuSampai,
        updatedAt: k.updatedAt,
      })),
    };
  }, { success: true, installed: false, items: [] });
}

export async function saveKnowledge(ctx: RequestCtx, body: unknown, now = new Date()): Promise<{ ok: true; item: KnowledgeDTO } | Failure> {
  if (!isRecord(body)) return failure(400, "Body permintaan tidak valid.");
  if (!KINDS.includes(body.jenis as KnowledgeKind)) return failure(400, "Jenis butir tidak valid.");
  const jenis = body.jenis as KnowledgeKind;
  const judul = typeof body.judul === "string" ? body.judul.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (judul.length < 2 || judul.length > KNOWLEDGE_TITLE_MAX) return failure(400, `Judul harus 2-${KNOWLEDGE_TITLE_MAX} karakter.`);
  if (typeof body.isi !== "string") return failure(400, "Isi tidak valid.");
  // Larangan disimpan per baris; butir lain dirapatkan menjadi satu paragraf.
  const isi =
    jenis === "LARANGAN"
      ? body.isi.replace(/[<>]/g, " ").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n")
      : body.isi.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  if (isi.length < 2 || isi.length > KNOWLEDGE_BODY_MAX) return failure(400, `Isi harus 2-${KNOWLEDGE_BODY_MAX} karakter.`);

  let berlakuSampai: string | null = null;
  if (body.berlakuSampai !== undefined && body.berlakuSampai !== null && body.berlakuSampai !== "") {
    if (!isDay(body.berlakuSampai)) return failure(400, "Tanggal berlaku tidak valid.");
    berlakuSampai = body.berlakuSampai;
  }
  if (jenis === "PROMO" && !berlakuSampai) return failure(400, "Promo wajib punya tanggal berakhir.");

  let accountId: string | null = null;
  if (body.accountId !== undefined && body.accountId !== null && body.accountId !== "") {
    if (typeof body.accountId !== "string") return failure(400, "Akun tidak valid.");
    if (!(await visibleAccounts(ctx)).some((a) => a.id === body.accountId)) return failure(404, "Akun Threads tidak ditemukan.");
    accountId = body.accountId;
  } else if (ctx.accountIds !== null) {
    // Pengguna berlingkup akun tertentu tidak boleh mengubah butir yang berlaku untuk semua akun.
    return failure(403, "Pilih akun: Anda hanya bisa mengatur butir untuk akun yang Anda kelola.");
  }
  const id = typeof body.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.id) ? body.id : undefined;

  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  const saved = await upsertKnowledge({ id, workspaceId, accountId, jenis, judul, isi, berlakuSampai }, ctx.accountIds, ctx.userId, now);
  return saved
    ? { ok: true, item: { id: saved, accountId, jenis, judul, isi, berlakuSampai, updatedAt: now.toISOString() } }
    : failure(404, "Butir tidak ditemukan.");
}

export async function removeKnowledge(ctx: RequestCtx, id: string, now = new Date()): Promise<{ ok: true } | Failure> {
  const workspaceId = await resolveWorkspace(ctx);
  if (!workspaceId) return failure(409, NO_WORKSPACE);
  return (await deleteKnowledge(id, workspaceId, ctx.accountIds, ctx.userId, now)) ? { ok: true } : failure(404, "Butir tidak ditemukan.");
}
