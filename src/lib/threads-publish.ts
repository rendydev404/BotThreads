/**
 * Domain posting Threads dari dashboard: buat posting/jadwal, ubah, batalkan, kirim ulang, daftar antrean.
 *
 * Arsitektur (PRD 4.1): dashboard hanya MEMASUKKAN baris ke antrean bersama (ScheduledPost +
 * PostDispatch publisher='THREADS'). Penerbitan sebenarnya (token, container, publish, retry, lock
 * anti-ganda) dikerjakan worker threads-publisher di auto-suka. Dashboard tidak memegang token.
 *
 * Prinsip:
 * - Semua pengecekan aturan memakai fungsi murni (scheduling.ts, threads-text.ts, post-status.ts).
 * - Operasi ubah/batal berkondisi atomik di database (fungsi RPC dash_edit_post/dash_cancel_post:
 *   UPDATE/DELETE bersyarat + cek jumlah baris dalam satu transaksi) agar aman dari balapan worker.
 * - Semua akses lewat supabase-js memanggil fungsi RPC (sql/003_dashboard_rpc.sql): agregasi di
 *   database, kolom eksplisit, paginasi kursor (tayangPada, id), tanpa N+1.
 */
import { randomUUID } from "node:crypto";
import { accountScope, rpc, utc, utcOrNull } from "@/lib/supabase";
import { currentScope } from "@/lib/tenant-scope";
import { isExcludedUsername } from "./account-visibility";
import { withKeys } from "./keyed-lock";
import { autopilotPostIds } from "./autopilot-store";
import {
  DASHBOARD_SOURCE,
  DUPLICATE_WINDOW_MS,
  EDIT_LOCK_MS,
  IDEMPOTENCY_WINDOW_MS,
  WORKER_LATE_MS,
  maxPostsPerDay,
  minGapMinutes,
} from "./content-config";
import type { CreateItemInput } from "./content-validation";
import {
  STATUS_LABEL,
  type CreatedPostDTO,
  type PostItemDTO,
  type PostStatusKey,
  type PostsSummaryDTO,
  type SkippedPostDTO,
} from "./content-types";
import { getPublishAccountMap, reasonText, type PublishAccount } from "./publish-accounts";
import { isAccountError, postStatusView } from "./post-status";
import {
  findScheduleViolation,
  resolveSlot,
  parsePublishAt,
  startOfWibDay,
  type ExistingSlot,
} from "./scheduling";
import {
  firstValidTopic,
  hasBranchTag,
  normalizeForCompare,
  postTitle,
  splitThreadsHashtagLines,
  validateThreadsText,
} from "./threads-text";

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ hasil & galat */

export interface Failure {
  ok: false;
  /** Status HTTP yang disarankan */
  status: number;
  error: string;
  details?: string[];
}

const failure = (status: number, error: string, details?: string[]): Failure => ({
  ok: false,
  status,
  error,
  ...(details?.length ? { details } : {}),
});

/** Tabel audit belum dibuat (sql/002_dashboard_post_log.sql belum dijalankan). */
export class MissingAuditTableError extends Error {
  constructor() {
    super("Tabel DashboardPostLog belum ada. Jalankan sql/002_dashboard_post_log.sql.");
    this.name = "MissingAuditTableError";
  }
}

export function isMissingAuditTable(err: unknown): boolean {
  if (err instanceof MissingAuditTableError) return true;
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  // 42P01 = undefined_table (PostgreSQL); PostgREST meneruskan kode ini apa adanya.
  if (e.code === "42P01") return /DashboardPostLog/.test(e.message ?? "");
  return /relation "(public\.)?DashboardPostLog" does not exist/i.test(e.message ?? "");
}

const who = (a: { username: string | null; displayName: string }) => `@${a.username ?? a.displayName}`;

/* ------------------------------------------------------------------ akses data (RPC) */

interface ScheduleRow {
  aid: string;
  postId: string;
  at: Date;
  source: string | null;
  caption: string;
}

/** Jadwal Terjadwal/Terbit (semua sumber) per akun Threads dalam rentang waktu. */
export async function fetchSchedule(ids: string[], from: Date, to: Date): Promise<ScheduleRow[]> {
  const rows = await rpc<(Omit<ScheduleRow, "at"> & { at: string })[]>("dash_schedule", {
    p_ids: ids,
    p_from: from,
    p_to: to,
  });
  return rows.map((r) => ({ ...r, at: utc(r.at) }));
}

/** Teks postingan Threads akun yang sudah terbit sejak `since` (untuk deteksi duplikat). */
async function fetchRecentTexts(ids: string[], since: Date): Promise<{ aid: string; text: string }[]> {
  return rpc<{ aid: string; text: string }[]>("dash_recent_texts", { p_ids: ids, p_since: since });
}

export interface ListQueryOptions {
  scope: "upcoming" | "history";
  accountUsername: string | null;
  status: PostStatusKey | null;
  cursor: { at: Date; id: string } | null;
  includeAll: boolean;
  limit: number;
  now: Date;
}

interface RawListRow extends Omit<ListRow, "tayangPada" | "lockedAt"> {
  tayangPada: string;
  lockedAt: string | null;
}

const parseListRow = (r: RawListRow): ListRow => ({
  ...r,
  tayangPada: utc(r.tayangPada),
  lockedAt: utcOrNull(r.lockedAt),
});

/**
 * Id akun dalam lingkup tenant pengguna untuk filter RPC. Undefined bila permintaan tidak dibatasi,
 * sehingga argumennya tidak dikirim sama sekali (fungsi lama tanpa parameter ini tetap bisa dipanggil).
 */
async function scopedAccountIds(): Promise<string[] | undefined> {
  return currentScope() ? (await accountScope()).visibleIds : undefined;
}

/* ------------------------------------------------------------------ pemetaan baris -> DTO */

interface ListRow {
  id: string;
  dispatchId: string;
  caption: string;
  hashtags: string[];
  tayangPada: Date;
  source: string | null;
  postStatus: string;
  dispatchStatus: string;
  pesanError: string | null;
  releaseUrl: string | null;
  platformContainerId: string | null;
  lockedAt: Date | null;
  threadsAccountId: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  outletNama: string | null;
}

export function toPostItem(row: ListRow, now: Date): PostItemDTO {
  const view = postStatusView(
    {
      postStatus: row.postStatus,
      dispatchStatus: row.dispatchStatus,
      tayangPada: row.tayangPada,
      platformContainerId: row.platformContainerId,
      lockedAt: row.lockedAt,
    },
    now
  );
  // Hanya posting dashboard yang boleh diubah dari sini; selain itu tampil baca-saja.
  const mine = row.source === DASHBOARD_SOURCE;
  const retryable = mine && view.retryable && !isAccountError(row.pesanError);
  return {
    id: row.id,
    dispatchId: row.dispatchId,
    text: row.caption,
    topicTag: firstValidTopic(row.hashtags),
    tayangPada: row.tayangPada.toISOString(),
    status: view.key,
    statusLabel: view.label,
    pesanError: row.pesanError,
    releaseUrl: row.releaseUrl,
    account: {
      id: row.threadsAccountId,
      username: row.username,
      displayName: row.displayName ?? row.username ?? "Akun tidak dikenal",
      avatarUrl: row.avatarUrl,
    },
    outletNama: row.outletNama,
    mine,
    editable: mine && view.editable,
    cancellable: mine && view.cancellable,
    retryable,
  };
}

/* ------------------------------------------------------------------ kursor */

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.getTime(), id])).toString("base64url");
}

export function decodeCursor(raw: string | null): { at: Date; id: string } | null {
  if (!raw || raw.length > 200) return null;
  try {
    const [ms, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as [unknown, unknown];
    if (typeof ms !== "number" || !Number.isFinite(ms) || typeof id !== "string" || !id || id.length > 64) {
      return null;
    }
    return { at: new Date(ms), id };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ baca */

export const LIST_PAGE_SIZE = 20;

export interface ListResult {
  items: PostItemDTO[];
  nextCursor: string | null;
  summary?: PostsSummaryDTO;
}

export async function listPosts(
  opts: Omit<ListQueryOptions, "limit" | "now" | "cursor"> & { cursor: string | null },
  now = new Date()
): Promise<ListResult> {
  const cursor = decodeCursor(opts.cursor);
  const dayStart = startOfWibDay(now);
  const accountIds = await scopedAccountIds();
  const [raw, summary] = await Promise.all([
    rpc<RawListRow[]>("dash_post_list", {
      p_scope: opts.scope,
      p_username: opts.accountUsername,
      p_status: opts.status,
      p_cursor_at: cursor?.at ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_include_all: opts.includeAll,
      p_limit: LIST_PAGE_SIZE,
      p_now: now,
      p_account_ids: accountIds,
    }),
    // Ringkasan hanya untuk halaman pertama; halaman berikutnya tidak perlu menghitung ulang.
    cursor
      ? Promise.resolve(null)
      : rpc<PostsSummaryDTO>("dash_post_summary", {
          p_include_all: opts.includeAll,
          p_day_start: dayStart,
          p_day_end: new Date(dayStart.getTime() + DAY_MS),
          p_week_ago: new Date(now.getTime() - 7 * DAY_MS),
          p_late_before: new Date(now.getTime() - WORKER_LATE_MS),
          p_account_ids: accountIds,
        }),
  ]);

  const rows = raw.map(parseListRow);
  const page = rows.slice(0, LIST_PAGE_SIZE);
  // Label "Autopilot": satu RPC ringan per halaman. Tanpa skema autopilot, daftar tetap tampil tanpa label.
  const auto = await autopilotPostIds(page.filter((r) => r.source === DASHBOARD_SOURCE).map((r) => r.id)).catch(() => new Set<string>());
  // Kursor dari baris terakhir sebelum disaring, supaya halaman berikutnya tidak melompat.
  const last = page.at(-1);
  return {
    items: page
      .filter((r) => !isExcludedUsername(r.username))
      .map((r) => ({ ...toPostItem(r, now), ...(auto.has(r.id) ? { autopilot: true } : {}) })),
    nextCursor: rows.length > LIST_PAGE_SIZE && last ? encodeCursor(last.tayangPada, last.dispatchId) : null,
    ...(summary ? { summary } : {}),
  };
}

/** Status ringkas untuk polling (maks 20 id). */
export async function getPostsByIds(ids: string[], includeAll: boolean, now = new Date()): Promise<PostItemDTO[]> {
  const rows = await rpc<RawListRow[]>("dash_posts_by_ids", {
    p_ids: ids,
    p_include_all: includeAll,
    p_account_ids: await scopedAccountIds(),
  });
  return rows.map((r) => toPostItem(parseListRow(r), now));
}

/* ------------------------------------------------------------------ buat */

export interface CreateInput {
  userId: string;
  idempotencyKey: string;
  items: CreateItemInput[];
  /**
   * Mode massal (orkestrator): item yang melanggar aturan dilewati dan dilaporkan di `skipped`,
   * sisanya tetap masuk antrean. Tanpa ini satu item bermasalah menggagalkan seluruh kiriman.
   */
  partial?: boolean;
  /**
   * Sistem yang mengatur jadwal (orkestrator/posting otomatis): bentrok jarak minimal atau kuota harian
   * diselesaikan dengan menggeser ke slot kosong terdekat, bukan ditolak. Pergeseran dilaporkan di
   * `rescheduledFrom` tiap posting.
   */
  autoReschedule?: boolean;
}

export type CreateResult =
  | { ok: true; posts: CreatedPostDTO[]; replayed: boolean; skipped?: SkippedPostDTO[] }
  | Failure;

// Permintaan serentak dengan key sama (klik ganda) digabung jadi satu eksekusi.
const inFlight = new Map<string, Promise<CreateResult>>();

export function createPosts(input: CreateInput, now = new Date()): Promise<CreateResult> {
  const flightKey = `${input.userId}:${input.idempotencyKey}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const task = doCreate(input, now).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, task);
  return task;
}

async function findReplay(key: string, now: Date): Promise<CreatedPostDTO[] | null> {
  const since = new Date(now.getTime() - IDEMPOTENCY_WINDOW_MS);
  const rows = await rpc<
    { postId: string; threadsAccountId: string | null; tayangPada: string | null; status: string | null }[]
  >("dash_replay", { p_key: key, p_since: since });
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    postId: r.postId,
    threadsAccountId: r.threadsAccountId ?? "",
    tayangPada: (r.tayangPada ? utc(r.tayangPada) : now).toISOString(),
    // Posting yang sudah dihapus/dibatalkan sejak itu tidak punya status lagi.
    status: r.status ?? "DIBATALKAN",
  }));
}

interface Prepared {
  item: CreateItemInput;
  account: PublishAccount;
  at: Date;
  immediate: boolean;
  /** Teks yang disimpan di ScheduledPost.caption (boleh memuat {nama_cabang}). */
  caption: string;
  topicTag: string | null;
  /** Waktu semula sebelum digeser otomatis karena bentrok. */
  movedFrom?: Date;
}

async function doCreate(input: CreateInput, now: Date): Promise<CreateResult> {
  try {
    const replay = await findReplay(input.idempotencyKey, now);
    if (replay) return { ok: true, posts: replay, replayed: true };
  } catch (err) {
    if (isMissingAuditTable(err)) throw new MissingAuditTableError();
    throw err;
  }

  const accounts = await getPublishAccountMap([...new Set(input.items.map((i) => i.threadsAccountId))]);
  const partial = input.partial === true;
  const skipped: SkippedPostDTO[] = [];
  const errors: string[] = [];
  let prepared: Prepared[] = [];

  for (const item of input.items) {
    const account = accounts.get(item.threadsAccountId);
    const reject = (error: string) => {
      errors.push(account ? `${who(account)}: ${error}` : error);
      skipped.push({ threadsAccountId: item.threadsAccountId, error });
    };
    if (!account) {
      reject("Akun Threads tidak ditemukan.");
      continue;
    }
    if (!account.ready || !account.outletId || !account.socialAccountId || !account.workspaceId) {
      reject(`akun belum siap diposting (${reasonText(account.reason) || "belum dipetakan"}).`);
      continue;
    }
    const check = validateThreadsText(item.text, account.outletNama ?? "", item.topicTag);
    if (!check.ok) {
      reject(check.error);
      continue;
    }
    const when = parsePublishAt(item.publishAt, now);
    if (!when.ok) {
      reject(when.error);
      continue;
    }
    prepared.push({
      item,
      account,
      at: when.at,
      immediate: when.immediate,
      caption: item.text.replace(/\r\n/g, "\n").trim(),
      topicTag: check.topicTag,
    });
  }
  if (errors.length && !partial) return failure(400, errors[0], errors);

  // Teks identik ke beberapa akun dianggap spam oleh Threads, kecuali memakai {nama_cabang}.
  const seen = new Map<string, string>();
  const unique: Prepared[] = [];
  for (const p of prepared) {
    const key = normalizeForCompare(p.caption);
    const other = seen.get(key);
    if (other && other !== p.account.id && !hasBranchTag(p.caption)) {
      const error =
        "Teks identik ke beberapa akun berisiko dianggap spam oleh Threads. Variasikan teks tiap akun atau pakai {nama_cabang}.";
      if (!partial) return failure(409, error);
      skipped.push({ threadsAccountId: p.account.id, error });
      continue;
    }
    seen.set(key, p.account.id);
    unique.push(p);
  }
  prepared = unique;
  if (prepared.length === 0) return { ok: true, posts: [], replayed: false, skipped };

  // Aturan (kuota harian, jarak minimal, teks kembar) diperiksa lalu ditulis sebagai satu langkah per
  // akun: tanpa kunci, dua permintaan serentak ke akun yang sama (mis. tick autopilot + posting manual)
  // sama-sama lolos pemeriksaan lalu melampaui kuota.
  return withKeys(
    prepared.map((p) => accountKey(p.account.id)),
    () => commitPrepared(input, prepared, skipped, partial, now)
  );
}

/** Kunci bersama untuk semua penulisan jadwal satu akun Threads (buat, ubah). */
const accountKey = (accountId: string) => `post-account:${accountId}`;

async function commitPrepared(
  input: CreateInput,
  prepared: Prepared[],
  skipped: SkippedPostDTO[],
  partial: boolean,
  now: Date
): Promise<CreateResult> {
  const violations = await checkRules(prepared, now, input.autoReschedule === true);
  if (violations.size && !partial) {
    const [first, message] = [...violations][0];
    return failure(409, `${who(first.account)}: ${message}`);
  }
  for (const [p, error] of violations) skipped.push({ threadsAccountId: p.account.id, error });
  prepared = prepared.filter((p) => !violations.has(p));
  if (prepared.length === 0) return { ok: true, posts: [], replayed: false, skipped };

  const batchId = randomUUID();
  const items: Record<string, unknown>[] = [];
  const posts: CreatedPostDTO[] = [];

  for (const p of prepared) {
    const postId = randomUUID();
    items.push({
      postId,
      workspaceId: p.account.workspaceId,
      judul: postTitle(p.caption),
      caption: p.caption,
      hashtags: p.topicTag ? [`#${p.topicTag}`] : [],
      tayangPada: p.at.toISOString(),
      batchId,
      outletId: p.account.outletId,
      socialAccountId: p.account.socialAccountId,
      userId: input.userId,
      action: p.immediate ? "CREATE_NOW" : "CREATE_SCHEDULED",
      aiModel: p.item.aiModel ?? null,
      aiEdited: p.item.aiModel ? p.item.aiEdited : null,
      detail: {
        idempotencyKey: input.idempotencyKey,
        batchId,
        threadsAccountId: p.account.id,
        tayangPada: p.at.toISOString(),
      },
    });
    posts.push({
      postId,
      threadsAccountId: p.account.id,
      tayangPada: p.at.toISOString(),
      status: "MENUNGGU",
      ...(p.movedFrom ? { rescheduledFrom: p.movedFrom.toISOString() } : {}),
    });
  }

  try {
    // Satu transaksi di database (dash_create_posts): semua item satu batch + log audit, atau tidak sama sekali.
    await rpc<number>("dash_create_posts", { p_items: items });
  } catch (err) {
    if (isMissingAuditTable(err)) throw new MissingAuditTableError();
    throw err;
  }
  return { ok: true, posts, replayed: false, ...(partial ? { skipped } : {}) };
}

/**
 * Anti-spam (kuota harian, jarak minimal) dan duplikat 7 hari terhadap data DB. Mengembalikan
 * pelanggaran per item, urut kronologis; kosong bila semua lolos. Item yang melanggar tidak ikut
 * menjadi pembanding item berikutnya.
 */
async function checkRules(prepared: Prepared[], now: Date, autoReschedule = false): Promise<Map<Prepared, string>> {
  const ids = [...new Set(prepared.map((p) => p.account.id))];
  const gapMs = minGapMinutes() * 60_000;
  const limits = { minGapMs: gapMs, maxPerDay: maxPostsPerDay() };

  const times = prepared.map((p) => p.at.getTime());
  const from = new Date(
    Math.min(now.getTime() - DUPLICATE_WINDOW_MS, startOfWibDay(new Date(Math.min(...times))).getTime() - gapMs)
  );
  const to = new Date(startOfWibDay(new Date(Math.max(...times))).getTime() + DAY_MS + gapMs);

  const [schedule, stats] = await Promise.all([
    fetchSchedule(ids, from, to),
    fetchRecentTexts(ids, new Date(now.getTime() - DUPLICATE_WINDOW_MS)),
  ]);

  const slotsByAccount = new Map<string, ExistingSlot[]>();
  const textsByAccount = new Map<string, Set<string>>();
  for (const id of ids) {
    slotsByAccount.set(id, []);
    textsByAccount.set(id, new Set());
  }
  const dupSince = now.getTime() - DUPLICATE_WINDOW_MS;
  for (const r of schedule) {
    slotsByAccount.get(r.aid)?.push({ at: r.at.getTime(), dashboard: r.source === DASHBOARD_SOURCE });
    if (r.at.getTime() >= dupSince) textsByAccount.get(r.aid)?.add(normalizeForCompare(r.caption));
  }
  for (const r of stats) textsByAccount.get(r.aid)?.add(normalizeForCompare(r.text));

  // Urut waktu per akun supaya pelanggaran dilaporkan pada item yang paling akhir secara kronologis.
  const ordered = [...prepared].sort((a, b) => a.at.getTime() - b.at.getTime());
  const violations = new Map<Prepared, string>();
  for (const p of ordered) {
    const slots = slotsByAccount.get(p.account.id)!;
    const violation = findScheduleViolation(p.at, slots, limits);
    if (violation) {
      const moved = autoReschedule ? resolveSlot(p.at, slots, limits, now) : null;
      if (!moved) {
        violations.set(p, autoReschedule ? `${violation} Tidak ada slot kosong dalam 14 hari ke depan.` : violation);
        continue;
      }
      p.movedFrom = p.at;
      p.at = moved;
      p.immediate = false;
    }

    const known = textsByAccount.get(p.account.id)!;
    const final = validateThreadsText(p.caption, p.account.outletNama ?? "", p.topicTag);
    const candidates = [normalizeForCompare(p.caption), final.ok ? normalizeForCompare(final.text) : ""];
    if (candidates.some((c) => c && known.has(c))) {
      violations.set(p, "teks yang sama sudah diposting atau dijadwalkan dalam 7 hari terakhir.");
      continue;
    }
    // Item lain di batch yang sama ikut menjadi pembanding.
    slotsByAccount.get(p.account.id)!.push({ at: p.at.getTime(), dashboard: true });
    for (const c of candidates) if (c) known.add(c);
  }
  return violations;
}

/* ------------------------------------------------------------------ ubah / batal / kirim ulang */

interface PostRecord {
  id: string;
  source: string | null;
  status: string;
  caption: string;
  hashtags: string[];
  tayangPada: Date;
  dispatch: {
    status: string;
    lockedAt: Date | null;
    platformContainerId: string | null;
    pesanError: string | null;
    outletNama: string | null;
    threadsAccountId: string | null;
  } | null;
}

async function loadPost(id: string): Promise<PostRecord | null> {
  const row = await rpc<
    | (Omit<PostRecord, "tayangPada" | "dispatch"> & {
        tayangPada: string;
        dispatch: (Omit<NonNullable<PostRecord["dispatch"]>, "lockedAt"> & { lockedAt: string | null }) | null;
      })
    | null
  >("dash_load_post", { p_id: id });
  if (!row) return null;
  return {
    ...row,
    tayangPada: utc(row.tayangPada),
    dispatch: row.dispatch ? { ...row.dispatch, lockedAt: utcOrNull(row.dispatch.lockedAt) } : null,
  };
}

const NOT_MINE = "Hanya postingan dari dashboard yang bisa diubah di sini. Kelola lainnya di SukaPost.";

/** Muat posting hanya bila akunnya berada dalam lingkup tenant pengguna; selain itu dianggap tidak ada. */
async function loadScopedPost(id: string): Promise<PostRecord | null> {
  const post = await loadPost(id);
  if (!post || !currentScope()) return post;
  const accountId = post.dispatch?.threadsAccountId;
  return accountId && (await accountScope()).visibleIds.includes(accountId) ? post : null;
}

export interface EditInput {
  userId: string;
  postId: string;
  text?: string;
  topicTag?: string | null;
  /** ISO 8601 */
  publishAt?: string;
}

export async function editPost(
  input: EditInput,
  now = new Date()
): Promise<{ ok: true; post: PostItemDTO | null } | Failure> {
  const post = await loadScopedPost(input.postId);
  if (!post) return failure(404, "Postingan tidak ditemukan.");
  if (post.source !== DASHBOARD_SOURCE) return failure(403, NOT_MINE);
  if (!post.dispatch) return failure(409, "Postingan ini tidak punya tujuan Threads.");

  const view = postStatusView(
    {
      postStatus: post.status,
      dispatchStatus: post.dispatch.status,
      tayangPada: post.tayangPada,
      platformContainerId: post.dispatch.platformContainerId,
      lockedAt: post.dispatch.lockedAt,
    },
    now
  );
  if (!view.editable) {
    return failure(409, "Postingan sudah diproses atau hampir tayang, sehingga tidak bisa diubah lagi.");
  }

  const nama = post.dispatch.outletNama ?? "";
  const newCaption = input.text !== undefined ? input.text.replace(/\r\n/g, "\n").trim() : post.caption;
  const currentTopic = firstValidTopic(post.hashtags);
  const newTopic = input.topicTag !== undefined ? input.topicTag : currentTopic;
  const check = validateThreadsText(newCaption, nama, newTopic);
  if (!check.ok) return failure(400, check.error);

  let newAt = post.tayangPada;
  if (input.publishAt !== undefined) {
    const when = parsePublishAt(input.publishAt, now);
    if (!when.ok) return failure(400, when.error);
    newAt = when.at;
  }

  const accountId = post.dispatch.threadsAccountId;
  return withKeys(accountId ? [accountKey(accountId)] : [], () =>
    commitEdit(input, post, { newAt, newCaption, check, accountId }, now)
  );
}

async function commitEdit(
  input: EditInput,
  post: PostRecord,
  next: { newAt: Date; newCaption: string; check: { text: string; topicTag: string | null }; accountId: string | null },
  now: Date
): Promise<{ ok: true; post: PostItemDTO | null } | Failure> {
  const { newAt, newCaption, check, accountId } = next;
  const timeChanged = newAt.getTime() !== post.tayangPada.getTime();
  const textChanged = normalizeForCompare(newCaption) !== normalizeForCompare(post.caption);
  if (accountId && (timeChanged || textChanged)) {
    const gapMs = minGapMinutes() * 60_000;
    const from = new Date(Math.min(now.getTime() - DUPLICATE_WINDOW_MS, startOfWibDay(newAt).getTime() - gapMs));
    const to = new Date(startOfWibDay(newAt).getTime() + DAY_MS + gapMs);
    const [schedule, stats] = await Promise.all([
      fetchSchedule([accountId], from, to),
      textChanged
        ? fetchRecentTexts([accountId], new Date(now.getTime() - DUPLICATE_WINDOW_MS))
        : Promise.resolve([] as { aid: string; text: string }[]),
    ]);
    const others = schedule.filter((r) => r.postId !== post.id);

    if (timeChanged) {
      const violation = findScheduleViolation(
        newAt,
        others.map((r) => ({ at: r.at.getTime(), dashboard: r.source === DASHBOARD_SOURCE })),
        { minGapMs: gapMs, maxPerDay: maxPostsPerDay() }
      );
      if (violation) return failure(409, violation);
    }
    if (textChanged) {
      const known = new Set<string>([
        ...others.filter((r) => r.at.getTime() >= now.getTime() - DUPLICATE_WINDOW_MS).map((r) => normalizeForCompare(r.caption)),
        ...stats.map((r) => normalizeForCompare(r.text)),
      ]);
      if ([normalizeForCompare(newCaption), normalizeForCompare(check.text)].some((c) => known.has(c))) {
        return failure(409, "Teks yang sama sudah diposting atau dijadwalkan dalam 7 hari terakhir.");
      }
    }
  }

  const setContent = textChanged || input.topicTag !== undefined;
  let updated: boolean;
  try {
    // Kondisi atomik di database: gagal bila worker sudah menguncinya atau waktunya terlalu dekat.
    updated = await rpc<boolean>("dash_edit_post", {
      p_id: post.id,
      p_user: input.userId,
      p_set_content: setContent,
      p_caption: setContent ? newCaption : null,
      p_judul: setContent ? postTitle(newCaption) : null,
      p_hashtags: setContent ? (check.topicTag ? [`#${check.topicTag}`] : []) : null,
      p_set_time: timeChanged,
      p_tayang: timeChanged ? newAt : null,
      p_min_time: new Date(now.getTime() + EDIT_LOCK_MS),
      p_detail: {
        text: textChanged,
        topic: input.topicTag !== undefined,
        time: timeChanged ? newAt.toISOString() : null,
      },
    });
  } catch (err) {
    if (isMissingAuditTable(err)) throw new MissingAuditTableError();
    throw err;
  }
  if (!updated) {
    return failure(409, "Postingan sudah diproses oleh penerbit, sehingga tidak bisa diubah lagi.");
  }
  const [item] = await getPostsByIds([post.id], false, now);
  return { ok: true, post: item ?? null };
}

export async function cancelPost(
  input: { userId: string; postId: string },
  now = new Date()
): Promise<{ ok: true } | Failure> {
  const post = await loadScopedPost(input.postId);
  if (!post) return failure(404, "Postingan tidak ditemukan.");
  if (post.source !== DASHBOARD_SOURCE) return failure(403, NOT_MINE);

  let deleted: boolean;
  try {
    // Hapus (cascade ke PostDispatch). Syarat sama dengan edit, kecuali jadwal yang sudah lewat
    // tetap boleh dibatalkan selama worker belum mengambilnya (mis. worker sedang mati).
    deleted = await rpc<boolean>("dash_cancel_post", {
      p_id: post.id,
      p_user: input.userId,
      p_detail: { tayangPada: post.tayangPada.toISOString(), at: now.toISOString() },
    });
  } catch (err) {
    if (isMissingAuditTable(err)) throw new MissingAuditTableError();
    throw err;
  }
  if (!deleted) {
    return failure(409, "Postingan sudah diproses oleh penerbit, sehingga tidak bisa dibatalkan lagi.");
  }
  return { ok: true };
}

export async function retryPost(
  input: { userId: string; postId: string },
  now = new Date()
): Promise<{ ok: true; post: PostItemDTO | null } | Failure> {
  const post = await loadScopedPost(input.postId);
  if (!post) return failure(404, "Postingan tidak ditemukan.");
  if (post.source !== DASHBOARD_SOURCE) return failure(403, NOT_MINE);
  if (!post.dispatch || post.dispatch.status !== "GAGAL" || post.status !== "GAGAL") {
    return failure(409, "Hanya postingan yang gagal yang bisa dikirim ulang.");
  }
  if (isAccountError(post.dispatch.pesanError)) {
    return failure(409, "Gagal karena sesi akun Threads. Hubungkan ulang akun cabang ini di SukaPost, lalu coba lagi.");
  }
  if (post.dispatch.threadsAccountId) {
    const account = (await getPublishAccountMap([post.dispatch.threadsAccountId])).get(post.dispatch.threadsAccountId);
    if (account && !account.ready) {
      return failure(409, `Akun belum siap diposting: ${reasonText(account.reason)}.`);
    }
  }

  let reset: boolean;
  try {
    reset = await rpc<boolean>("dash_retry_post", {
      p_id: post.id,
      p_user: input.userId,
      p_now: now,
      p_detail: { previousError: post.dispatch?.pesanError ?? null },
    });
  } catch (err) {
    if (isMissingAuditTable(err)) throw new MissingAuditTableError();
    throw err;
  }
  if (!reset) return failure(409, "Status postingan berubah. Muat ulang daftar lalu coba lagi.");
  const [item] = await getPostsByIds([post.id], false, now);
  return { ok: true, post: item ?? null };
}

/** Dipakai UI dan pengujian: label status. */
export const statusLabel = (key: PostStatusKey): string => STATUS_LABEL[key];

// splitThreadsHashtagLines diekspor ulang agar konsumen domain cukup satu import.
export { splitThreadsHashtagLines };
