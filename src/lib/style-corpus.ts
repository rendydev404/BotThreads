/**
 * Korpus gaya Threads ("otak gaya", fase A): contoh postingan nyata yang ditiru RITME dan LAYOUT-nya oleh
 * penulis AI, plus ringkasan layout yang terbukti ramai (LayoutProfile).
 *
 * Sumber (sql/041_style_corpus.sql, satu RPC): postingan akun sendiri (OWN) dan akun lain di workspace yang
 * sama (WORKSPACE) dari ThreadsPostStat, serta contoh yang ditempel pemilik akun (MANUAL, tabel
 * StyleExample). Ketat per workspace (tenant): RPC tidak pernah mengembalikan data workspace lain.
 *
 * Kandidat (maks 150, sudah dipangkas di SQL menurut views relatif terhadap median penulisnya) di-cache
 * 10 menit per (workspace, akun); pemeringkatan per permintaan (topik, format) murni di memori.
 * Tidak pernah melempar galat: kegagalan atau SQL yang belum dipasang menghasilkan [] / null.
 */
import { isExcludedUsername } from "./account-visibility";
import {
  POST_FORMATS,
  detectFormat,
  engagementScore,
  layoutFeatures,
  type LayoutProfile,
  type PostFormat,
  type StyleExemplar,
} from "./style-types";
import { rpc, sqlTs } from "./supabase";

const TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
/** Jendela postingan yang dibaca (hari). */
export const STYLE_CORPUS_DAYS = 120;
/** Kandidat maksimal dari SQL. */
const CANDIDATE_LIMIT = 150;
/** Skor minimal postingan OWN/WORKSPACE (engagementScore) supaya layak ditiru. */
export const MIN_STYLE_SCORE = 0.3;
const OWN_BOOST = 0.2;
/** Contoh manual selalu layak dengan peringkat tetap di atas skor tertinggi (2 + bonus OWN). */
const MANUAL_RANK = 3;
const PREFER_BOOST = 0.5;
const TOPIC_WEIGHT = 2;
const NEAR_DUP = 0.6;
const MAX_PER_FORMAT = 2;
const MIN_PROFILE_SAMPLE = 5;

/** Contoh gaya manual (StyleExample) untuk UI. */
export interface StyleExampleDTO {
  id: string;
  /** Null = berlaku untuk semua akun di workspace. */
  accountId: string | null;
  text: string;
  format: PostFormat;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface RawPost {
  id: string;
  aid: string;
  handle: string | null;
  source: "OWN" | "WORKSPACE";
  text: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  medViews: number;
  medReplies: number;
}

interface RawManual {
  id: string;
  accountId: string | null;
  text: string;
  format: string;
  note: string | null;
}

interface RawCandidates {
  posts: RawPost[];
  manual: RawManual[];
}

/** Contoh beserta token isinya (untuk deteksi hampir-sama dan kecocokan topik). */
export interface CorpusEntry extends StyleExemplar {
  tokens: Set<string>;
}

// ------------------------------------------------------------------ teks (murni)

const STOPWORDS = new Set(
  (
    "yang dan di ke dari ini itu aku gue gua gw saya kamu lu lo elo kita kami mereka dia ada tidak gak ga nggak " +
    "enggak engga aja saja juga udah sudah belum bisa akan mau lagi karena karna kalau kalo jadi untuk buat dengan " +
    "sama atau tapi pada dalam yg dgn nya banget sih deh dong kok kan ya yah nih tuh apa gimana bagaimana kenapa " +
    "the and adalah oleh seperti lebih sangat masih pun hanya cuma emang memang biar supaya setelah sebelum kayak " +
    "kaya pas bang kak guys orang hari aja tau tahu gitu begitu gini begini bikin sangat terus trus abis habis"
  ).split(" ")
);

/** Kata isi (huruf kecil, tanpa tanda baca dan kata umum, minimal 3 huruf). */
export function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Jaccard dua himpunan (0 bila salah satunya kosong). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (big.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const isFormat = (v: unknown): v is PostFormat => typeof v === "string" && (POST_FORMATS as readonly string[]).includes(v);

/** Baris RPC -> entri korpus (murni). Akun yang dikecualikan dari dashboard dibuang. */
export function buildCorpus(raw: RawCandidates): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const m of raw.manual ?? []) {
    if (!m?.text?.trim()) continue;
    out.push({
      id: m.id,
      text: m.text,
      format: isFormat(m.format) ? m.format : detectFormat(m.text),
      features: layoutFeatures(m.text),
      score: null,
      source: "MANUAL",
      handle: null,
      tokens: contentTokens(m.text),
    });
  }
  for (const p of raw.posts ?? []) {
    if (!p?.text?.trim() || isExcludedUsername(p.handle)) continue;
    out.push({
      id: p.id,
      text: p.text,
      format: detectFormat(p.text),
      features: layoutFeatures(p.text),
      score: Math.round(engagementScore(p, { views: p.medViews, replies: p.medReplies }) * 1000) / 1000,
      source: p.source === "OWN" ? "OWN" : "WORKSPACE",
      handle: p.handle ?? null,
      tokens: contentTokens(p.text),
    });
  }
  return out;
}

export interface RankOptions {
  topicHint?: string;
  preferFormats?: PostFormat[];
  limit?: number;
}

/**
 * Pilih contoh terbaik (murni). Postingan OWN/WORKSPACE dengan skor < 0.3 dibuang; contoh MANUAL selalu
 * layak dengan peringkat tetap tinggi. Peringkat = skor (+0.2 OWN) + bonus format yang diminta + kecocokan
 * kata dengan topik. Pemilihan rakus: lewati yang hampir sama (Jaccard > 0.6) dengan yang sudah terpilih,
 * dan maks 2 per format kecuali format itu diminta. Bila kuota belum penuh, putaran kedua melonggarkan
 * batas format (hampir-sama tetap dilarang).
 */
export function rankExemplars(pool: CorpusEntry[], opts: RankOptions = {}): StyleExemplar[] {
  const limit = Math.max(1, Math.min(20, Math.floor(opts.limit ?? 5)));
  const prefer = new Set(opts.preferFormats ?? []);
  const topic = opts.topicHint ? contentTokens(opts.topicHint) : null;

  const ranked = pool
    .filter((e) => e.source === "MANUAL" || (e.score ?? -Infinity) >= MIN_STYLE_SCORE)
    .map((e) => {
      let r = e.source === "MANUAL" ? MANUAL_RANK : (e.score ?? 0) + (e.source === "OWN" ? OWN_BOOST : 0);
      if (prefer.has(e.format)) r += PREFER_BOOST;
      if (topic?.size) r += TOPIC_WEIGHT * jaccard(topic, e.tokens);
      return { e, r };
    })
    .sort((a, b) => b.r - a.r || a.e.id.localeCompare(b.e.id));

  const chosen: CorpusEntry[] = [];
  const perFormat = new Map<PostFormat, number>();
  const pick = (capFormats: boolean) => {
    for (const { e } of ranked) {
      if (chosen.length >= limit) return;
      if (chosen.includes(e)) continue;
      if (capFormats && !prefer.has(e.format) && (perFormat.get(e.format) ?? 0) >= MAX_PER_FORMAT) continue;
      if (chosen.some((c) => jaccard(c.tokens, e.tokens) > NEAR_DUP)) continue;
      chosen.push(e);
      perFormat.set(e.format, (perFormat.get(e.format) ?? 0) + 1);
    }
  };
  pick(true);
  if (chosen.length < limit) pick(false);
  return chosen.map(toExemplar);
}

const toExemplar = (e: CorpusEntry): StyleExemplar => ({
  id: e.id,
  text: e.text,
  format: e.format,
  features: e.features,
  score: e.score,
  source: e.source,
  handle: e.handle,
});

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const share = (n: number, d: number) => Math.round((n / d) * 100) / 100;

/** Ringkasan layout postingan berskor ≥ 0.3 (murni). Null bila kurang dari 5 postingan. */
export function profileOf(pool: CorpusEntry[]): LayoutProfile | null {
  const good = pool.filter((e) => e.source !== "MANUAL" && (e.score ?? -Infinity) >= MIN_STYLE_SCORE);
  if (good.length < MIN_PROFILE_SAMPLE) return null;
  const n = good.length;
  const byFormat = new Map<PostFormat, { n: number; sum: number }>();
  for (const e of good) {
    const f = byFormat.get(e.format) ?? { n: 0, sum: 0 };
    f.n++;
    f.sum += e.score ?? 0;
    byFormat.set(e.format, f);
  }
  return {
    sample: n,
    medianChars: Math.round(median(good.map((e) => e.features.chars))),
    medianLines: Math.round(median(good.map((e) => e.features.lines))),
    listShare: share(good.filter((e) => e.features.isList).length, n),
    lowercaseShare: share(good.filter((e) => e.features.startsLowercase).length, n),
    questionShare: share(good.filter((e) => e.features.endsQuestion).length, n),
    emojiShare: share(good.filter((e) => e.features.emojiCount > 0).length, n),
    topFormats: [...byFormat.entries()]
      .map(([format, f]) => ({ format, share: share(f.n, n), avgScore: Math.round((f.sum / f.n) * 100) / 100 }))
      .sort((a, b) => b.share - a.share || b.avgScore - a.avgScore),
  };
}

// ------------------------------------------------------------------ data (cache)

const cache = new Map<string, { at: number; value: CorpusEntry[] }>();
const pending = new Map<string, Promise<CorpusEntry[]>>();

/** SQL korpus (sql/041) atau prasyaratnya belum dipasang. */
export const isMissingStyleSchema = (err: unknown): boolean =>
  /PGRST202|42883|42P01/.test(err instanceof Error ? err.message : String(err));

/** Buang cache korpus satu workspace (setelah contoh manual berubah), atau semuanya. */
export function forgetStyleCorpus(workspaceId?: string): void {
  if (!workspaceId) {
    cache.clear();
    return;
  }
  const prefix = `${workspaceId}|`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

async function loadCorpus(workspaceId: string, accountId: string): Promise<CorpusEntry[]> {
  const key = `${workspaceId}|${accountId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let p = pending.get(key);
  if (!p) {
    p = rpc<RawCandidates>("dash_style_candidates", {
      p_workspace: workspaceId,
      p_account: accountId,
      p_since: sqlTs(new Date(Date.now() - STYLE_CORPUS_DAYS * 86_400_000)),
      p_limit: CANDIDATE_LIMIT,
    })
      .then((raw) => {
        const value = buildCorpus(raw ?? { posts: [], manual: [] });
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

async function safeCorpus(workspaceId: string, accountId: string): Promise<CorpusEntry[] | null> {
  if (!workspaceId || !accountId) return null;
  try {
    return await loadCorpus(workspaceId, accountId);
  } catch (err) {
    if (!isMissingStyleSchema(err)) console.warn("[style-corpus] gagal memuat korpus:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Contoh gaya terbaik untuk satu akun (default 5). Tidak pernah melempar; gagal = []. */
export async function styleExemplars(input: {
  workspaceId: string;
  accountId: string;
  topicHint?: string;
  preferFormats?: PostFormat[];
  limit?: number;
}): Promise<StyleExemplar[]> {
  const pool = await safeCorpus(input.workspaceId, input.accountId);
  if (!pool?.length) return [];
  return rankExemplars(pool, input);
}

/** Ringkasan layout yang terbukti ramai di korpus akun ini. Null bila data < 5 postingan atau gagal. */
export async function layoutProfile(workspaceId: string, accountId: string): Promise<LayoutProfile | null> {
  const pool = await safeCorpus(workspaceId, accountId);
  return pool ? profileOf(pool) : null;
}

// ------------------------------------------------------------------ contoh manual (CRUD)

const toDto = (r: Omit<StyleExampleDTO, "format"> & { format: string }): StyleExampleDTO => ({
  ...r,
  format: isFormat(r.format) ? r.format : detectFormat(r.text),
});

/** Contoh manual workspace; accountId null = semua, berisi = akun itu + yang berlaku untuk semua akun. */
export async function listStyleExamples(workspaceId: string, accountId: string | null): Promise<StyleExampleDTO[]> {
  const rows = await rpc<(Omit<StyleExampleDTO, "format"> & { format: string })[]>("dash_style_example_list", {
    p_workspace: workspaceId,
    p_account: accountId ?? undefined,
  });
  return (rows ?? []).map(toDto);
}

export async function addStyleExample(input: {
  workspaceId: string;
  accountId: string | null;
  text: string;
  format: PostFormat;
  note: string | null;
  userId: string;
}): Promise<StyleExampleDTO> {
  const row = await rpc<Omit<StyleExampleDTO, "format"> & { format: string }>("dash_style_example_add", {
    p_workspace: input.workspaceId,
    p_account: input.accountId,
    p_text: input.text,
    p_format: input.format,
    p_note: input.note,
    p_user: input.userId,
    p_now: sqlTs(new Date()),
  });
  forgetStyleCorpus(input.workspaceId);
  return toDto(row);
}

/**
 * Hapus contoh milik workspace. `accounts` (lingkup pengguna) membatasi ke contoh akun-akun itu; null =
 * semua contoh workspace. True bila terhapus.
 */
export async function deleteStyleExample(workspaceId: string, id: string, accounts: string[] | null): Promise<boolean> {
  const res = await rpc<{ accountId: string | null } | null>("dash_style_example_delete", {
    p_workspace: workspaceId,
    p_id: id,
    p_accounts: accounts ?? undefined,
  });
  if (res) forgetStyleCorpus(workspaceId);
  return !!res;
}
