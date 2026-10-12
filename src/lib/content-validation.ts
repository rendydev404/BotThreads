/**
 * Validasi bentuk body permintaan API (murni). Tanpa dependensi tambahan (zod belum disetujui
 * pemilik); semua pesan galat berbahasa Indonesia dan batas panjang diberlakukan di server.
 */
import {
  MAX_BATCH_ITEMS,
  MAX_RECOMMEND_ACCOUNTS,
  MAX_RECOMMEND_COUNT,
} from "./content-config";
import { parseTopicTag } from "./threads-text";

export const MAX_BRIEF_CHARS = 600;
/** Batas kasar teks mentah dari klien; batas 500 karakter Threads dicek terpisah. */
const MAX_RAW_TEXT = 2000;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export interface CreateItemInput {
  threadsAccountId: string;
  text: string;
  topicTag: string | null;
  /** "now" atau ISO 8601 */
  publishAt: string;
  aiModel: string | null;
  aiEdited: boolean;
}

export interface CreateBody {
  idempotencyKey: string;
  items: CreateItemInput[];
  /** Item yang melanggar aturan dilewati (dilaporkan per akun) alih-alih menggagalkan seluruh kiriman. */
  partial: boolean;
  /** Bentrok jadwal digeser otomatis ke slot kosong terdekat (sistem yang mengatur jadwal). */
  autoReschedule: boolean;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

export function parseCreateBody(body: unknown): Parsed<CreateBody> {
  if (!isRecord(body)) return fail("Permintaan tidak valid.");

  const key = body.idempotencyKey;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    return fail("idempotencyKey wajib diisi (8-100 karakter huruf, angka, - atau _).");
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail("Pilih minimal satu akun dan isi teks postingan.");
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    return fail(`Maksimal ${MAX_BATCH_ITEMS} postingan dalam satu kali kirim.`);
  }

  const items: CreateItemInput[] = [];
  for (const [i, raw] of rawItems.entries()) {
    const n = i + 1;
    if (!isRecord(raw)) return fail(`Item ${n} tidak valid.`);

    const threadsAccountId = raw.threadsAccountId;
    if (typeof threadsAccountId !== "string" || !threadsAccountId || threadsAccountId.length > 100) {
      return fail(`Item ${n}: akun belum dipilih.`);
    }
    const text = raw.text;
    if (typeof text !== "string" || !text.trim()) return fail(`Item ${n}: teks postingan tidak boleh kosong.`);
    if (text.length > MAX_RAW_TEXT) return fail(`Item ${n}: teks terlalu panjang.`);

    const topic = parseTopicTag(raw.topicTag);
    if (!topic.ok) return fail(`Item ${n}: ${topic.error}`);

    const publishAt = raw.publishAt;
    if (typeof publishAt !== "string" || (publishAt !== "now" && publishAt.length > 40)) {
      return fail(`Item ${n}: waktu posting tidak valid.`);
    }

    const aiModel = raw.aiModel;
    if (aiModel !== undefined && aiModel !== null && (typeof aiModel !== "string" || aiModel.length > 80)) {
      return fail(`Item ${n}: aiModel tidak valid.`);
    }

    items.push({
      threadsAccountId,
      text,
      topicTag: topic.tag,
      publishAt,
      aiModel: typeof aiModel === "string" && aiModel ? aiModel : null,
      aiEdited: raw.aiEdited === true,
    });
  }
  return {
    ok: true,
    value: { idempotencyKey: key, items, partial: body.partial === true, autoReschedule: body.autoReschedule === true },
  };
}

/** Batas akun per putaran orkestrator (jaringan saat ini puluhan akun). */
export const MAX_ORCHESTRATE_ACCOUNTS = 100;

export interface OrchestrateBody {
  /** null = semua akun. */
  accountIds: string[] | null;
  topic: string;
  /** Jam manual WIB untuk semua akun; null = jam terbaik tiap akun. */
  fixedTime: { hour: number; minute: number } | null;
  /** Teks draf yang sedang diganti (buat ulang satu akun). */
  avoid: string | null;
  /** Posting otomatis: draf langsung masuk antrean; null = draf saja (ditinjau dulu). */
  publish: { mode: "now" | "schedule"; dayOffset: number | null; hourWib: number | null } | null;
}

export function parseOrchestrateBody(body: unknown): Parsed<OrchestrateBody> {
  if (!isRecord(body)) return fail("Permintaan tidak valid.");

  let accountIds: string[] | null = null;
  if (body.accountIds !== undefined && body.accountIds !== null) {
    const ids = body.accountIds;
    if (!Array.isArray(ids) || ids.length === 0) return fail("Pilih minimal satu akun.");
    if (ids.length > MAX_ORCHESTRATE_ACCOUNTS) return fail(`Maksimal ${MAX_ORCHESTRATE_ACCOUNTS} akun per putaran.`);
    if (ids.some((id) => typeof id !== "string" || !id || id.length > 100)) return fail("Daftar akun tidak valid.");
    accountIds = [...new Set(ids as string[])];
  }

  const topic = body.topic;
  if (topic !== undefined && topic !== null && typeof topic !== "string") return fail("Topik tidak valid.");
  if (typeof topic === "string" && topic.length > MAX_BRIEF_CHARS) {
    return fail(`Topik maksimal ${MAX_BRIEF_CHARS} karakter.`);
  }

  let fixedTime: OrchestrateBody["fixedTime"] = null;
  if (body.time !== undefined && body.time !== null && body.time !== "") {
    const m = typeof body.time === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(body.time) : null;
    if (!m) return fail("Format jam harus HH:MM (WIB).");
    fixedTime = { hour: Number(m[1]), minute: Number(m[2]) };
  }

  const avoid = body.avoid;
  if (avoid !== undefined && avoid !== null && (typeof avoid !== "string" || avoid.length > MAX_RAW_TEXT)) {
    return fail("Teks yang dihindari tidak valid.");
  }

  let publish: OrchestrateBody["publish"] = null;
  if (body.publish !== undefined && body.publish !== null) {
    const p = body.publish;
    const intOrNull = (v: unknown, min: number, max: number) =>
      v === null || v === undefined ? null : Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? (v as number) : NaN;
    if (!isRecord(p) || (p.mode !== "now" && p.mode !== "schedule")) return fail("Mode posting tidak valid.");
    const dayOffset = intOrNull(p.dayOffset, 0, 30);
    const hourWib = intOrNull(p.hourWib, 0, 23);
    if (Number.isNaN(dayOffset) || Number.isNaN(hourWib)) return fail("Jadwal posting tidak valid.");
    publish = { mode: p.mode, dayOffset, hourWib };
  }

  return {
    ok: true,
    value: {
      accountIds,
      topic: typeof topic === "string" ? topic.trim() : "",
      fixedTime,
      avoid: typeof avoid === "string" && avoid.trim() ? avoid.trim() : null,
      publish,
    },
  };
}

export interface RecommendBody {
  accountIds: string[];
  brief: string;
  count: number;
  /** Hari target "YYYY-MM-DD" (WIB) */
  date: string | null;
  avoid: string | null;
}

export function parseRecommendBody(body: unknown): Parsed<RecommendBody> {
  if (!isRecord(body)) return fail("Permintaan tidak valid.");

  const ids = body.accountIds;
  if (!Array.isArray(ids) || ids.length === 0) return fail("Pilih minimal satu akun.");
  if (ids.length > MAX_RECOMMEND_ACCOUNTS) {
    return fail(`Maksimal ${MAX_RECOMMEND_ACCOUNTS} akun per permintaan.`);
  }
  const accountIds = [...new Set(ids)];
  if (accountIds.some((id) => typeof id !== "string" || !id || id.length > 100)) {
    return fail("Daftar akun tidak valid.");
  }

  const brief = body.brief;
  if (brief !== undefined && brief !== null && typeof brief !== "string") return fail("Brief tidak valid.");
  if (typeof brief === "string" && brief.length > MAX_BRIEF_CHARS) {
    return fail(`Brief maksimal ${MAX_BRIEF_CHARS} karakter.`);
  }

  let count = 3;
  if (body.count !== undefined && body.count !== null) {
    if (typeof body.count !== "number" || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_RECOMMEND_COUNT) {
      return fail(`Jumlah draf harus 1-${MAX_RECOMMEND_COUNT}.`);
    }
    count = body.count;
  }

  let date: string | null = null;
  if (body.date !== undefined && body.date !== null) {
    if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return fail("Format tanggal harus YYYY-MM-DD.");
    }
    date = body.date;
  }

  const avoid = body.avoid;
  if (avoid !== undefined && avoid !== null && (typeof avoid !== "string" || avoid.length > MAX_BRIEF_CHARS)) {
    return fail("Teks yang dihindari tidak valid.");
  }

  return {
    ok: true,
    value: {
      accountIds: accountIds as string[],
      brief: typeof brief === "string" ? brief.trim() : "",
      count,
      date,
      avoid: typeof avoid === "string" && avoid.trim() ? avoid.trim() : null,
    },
  };
}

export interface PatchBody {
  text?: string;
  topicTag?: string | null;
  publishAt?: string;
}

export function parsePatchBody(body: unknown): Parsed<PatchBody> {
  if (!isRecord(body)) return fail("Permintaan tidak valid.");
  const out: PatchBody = {};

  if (body.text !== undefined) {
    if (typeof body.text !== "string" || !body.text.trim()) return fail("Teks postingan tidak boleh kosong.");
    if (body.text.length > MAX_RAW_TEXT) return fail("Teks terlalu panjang.");
    out.text = body.text;
  }
  if (body.topicTag !== undefined) {
    const topic = parseTopicTag(body.topicTag);
    if (!topic.ok) return fail(topic.error);
    out.topicTag = topic.tag;
  }
  if (body.publishAt !== undefined) {
    if (typeof body.publishAt !== "string" || body.publishAt === "now" || body.publishAt.length > 40) {
      return fail("Waktu posting tidak valid.");
    }
    out.publishAt = body.publishAt;
  }
  if (out.text === undefined && out.topicTag === undefined && out.publishAt === undefined) {
    return fail("Tidak ada perubahan yang dikirim.");
  }
  return { ok: true, value: out };
}

/** Daftar id untuk polling status: maksimal 20, unik, hanya karakter id yang wajar. */
export function parseIdList(raw: string | null, max = 20): string[] | null {
  if (!raw) return null;
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > max) return null;
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) return null;
  return ids;
}
