/**
 * Aturan teks Threads (murni, tanpa I/O). Dicerminkan dari penerbit auto-suka
 * (threads-publisher.service.ts + lib/caption.ts) supaya validasi dashboard persis sama dengan
 * yang akan dikerjakan worker saat terbit: apa yang lolos di sini tidak boleh gagal di worker.
 */

/** Batas teks Threads (karakter Unicode, bukan unit UTF-16). */
export const THREADS_MAX_TEXT = 500;
/** Batas aman draf AI: sisakan ruang dari batas 500. */
export const DRAFT_MAX_CHARS = 450;
/** Batas panjang topik Threads. */
const TOPIC_MAX = 50;

/** Jumlah karakter Unicode (emoji dihitung satu, bukan dua seperti `.length`). */
export const charLength = (s: string): number => [...s].length;

/** Potong ke `max` karakter Unicode tanpa memutus pasangan surrogate. */
export const clipChars = (s: string, max: number): string => {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
};

/** Tag nama cabang di caption; {nama_outlet} tetap didukung untuk jadwal lama. */
const TAG_NAMA_CABANG = /{nama_(?:cabang|outlet)}/g;

export const hasBranchTag = (text: string): boolean => /{nama_(?:cabang|outlet)}/.test(text);

/** Caption final seperti yang disusun worker: tag nama cabang diganti, hashtag ditambahkan di akhir. */
export function buildCaption(caption: string, hashtags: string[], namaCabang: string): string {
  const teks = caption.replace(TAG_NAMA_CABANG, namaCabang);
  if (!teks.trim()) return hashtags.join(" ");
  return `${teks}\n\n${hashtags.join(" ")}`.trimEnd();
}

const HASHTAG_LINE = /^\s*(?:#[\p{L}\p{N}_]+[\s,]*)+$/u;

/**
 * Pisahkan baris yang isinya hanya hashtag di awal/akhir teks. Di Threads, hashtag seperti itu
 * seharusnya jadi topik, bukan ikut tampil di teks. Hashtag di tengah kalimat dibiarkan.
 */
export function splitThreadsHashtagLines(text: string): { text: string; hashtags: string[] } {
  const lines = text.split("\n");
  const tags: string[] = [];
  const take = (line: string) => tags.push(...(line.match(/#[\p{L}\p{N}_]+/gu) || []));
  while (lines.length && (HASHTAG_LINE.test(lines[0]) || !lines[0].trim())) {
    const line = lines.shift()!;
    if (line.trim()) take(line);
  }
  const tail: string[] = [];
  while (lines.length && (HASHTAG_LINE.test(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) {
    const line = lines.pop()!;
    if (line.trim()) tail.unshift(line);
  }
  tail.forEach(take);
  return { text: lines.join("\n").trim(), hashtags: tags };
}

/** Syarat topik Threads: 1-50 karakter, tanpa titik dan "&". */
const isValidTopicTag = (tag: string): boolean =>
  tag.length >= 1 && charLength(tag) <= TOPIC_MAX && !/[.&\n\r]/.test(tag);

/** Hashtag pertama yang valid dijadikan topik (sama dengan threadsTopicTag di worker). */
export function firstValidTopic(hashtags: string[] | null | undefined): string | null {
  for (const raw of hashtags || []) {
    const tag = raw.trim().replace(/^#+/, "");
    if (isValidTopicTag(tag)) return tag;
  }
  return null;
}

/** Rapikan topik dari AI/pengguna: buang "#", spasi tepi; null bila kosong atau tidak valid. */
export function normalizeTopicTag(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().replace(/^#+/, "").trim();
  return isValidTopicTag(tag) ? tag : null;
}

export type TopicParse = { ok: true; tag: string | null } | { ok: false; error: string };

/** Topik dari input pengguna: kosong boleh, tetapi yang diisi harus valid. */
export function parseTopicTag(raw: unknown): TopicParse {
  if (raw === null || raw === undefined) return { ok: true, tag: null };
  if (typeof raw !== "string") return { ok: false, error: "Topik tidak valid." };
  const tag = raw.trim().replace(/^#+/, "").trim();
  if (!tag) return { ok: true, tag: null };
  if (!isValidTopicTag(tag)) {
    return { ok: false, error: "Topik harus 1-50 karakter, tanpa titik (.) atau tanda &." };
  }
  return { ok: true, tag };
}

export type TextCheck =
  | { ok: true; text: string; topicTag: string | null; length: number }
  | { ok: false; error: string; length: number };

/**
 * Validasi teks persis seperti worker memprosesnya: ganti {nama_cabang}, pisahkan baris hashtag
 * menjadi topik, lalu hitung panjang teks akhir (maks 500). `topicTag` eksplisit diutamakan.
 */
export function validateThreadsText(
  rawText: string,
  namaCabang: string,
  topicTag?: string | null
): TextCheck {
  const input = rawText.replace(/\r\n/g, "\n").trim();
  if (!input) return { ok: false, error: "Teks postingan tidak boleh kosong.", length: 0 };

  const raw = buildCaption(input, [], namaCabang).trim();
  let split = splitThreadsHashtagLines(raw);
  // Postingan teks yang isinya hanya hashtag tetap diterbitkan apa adanya (teks Threads tidak boleh kosong).
  if (!split.text) split = { text: raw, hashtags: [] };

  const length = charLength(split.text);
  if (length > THREADS_MAX_TEXT) {
    return {
      ok: false,
      error: `Teks ${length} karakter. Threads maksimal ${THREADS_MAX_TEXT} karakter.`,
      length,
    };
  }
  return {
    ok: true,
    text: split.text,
    topicTag: normalizeTopicTag(topicTag) ?? firstValidTopic(split.hashtags),
    length,
  };
}

/** Judul internal ScheduledPost: "Dashboard AI · <baris pertama 50 karakter>". */
export function postTitle(text: string): string {
  const first = text.split("\n").find((l) => l.trim()) ?? text;
  return `Dashboard AI · ${clipChars(first.replace(/\s+/g, " ").trim(), 50)}`;
}

/** Posisi akhir (indeks karakter Unicode) tempat memotong rapi: batas kalimat atau baris. */
function sentenceCut(chars: string[], max: number): number {
  const floor = Math.floor(max * 0.6);
  for (let i = Math.min(chars.length, max) - 1; i > floor; i--) {
    const c = chars[i];
    if (c === "\n") return i;
    if ((c === "." || c === "?" || c === "!") && (i + 1 >= chars.length || /\s/.test(chars[i + 1]))) {
      return i + 1;
    }
  }
  return Math.min(chars.length, max);
}

/** Rapikan keluaran AI: buang markdown tebal, prefix "Caption:", kutip pembungkus; potong rapi ke batas. */
export function cleanCaption(raw: string, max = DRAFT_MAX_CHARS): string {
  let t = raw.replace(/\*\*/g, "").replace(/\r\n/g, "\n").trim();
  t = t.replace(/^(caption|teks|draf)\s*:\s*/i, "").trim();
  if (/^["\u201c][\s\S]*["\u201d]$/.test(t)) t = t.slice(1, -1).trim();
  const chars = [...t];
  if (chars.length > max) t = chars.slice(0, sentenceCut(chars, max)).join("").trim();
  return t;
}

/* ------------------------------------------------------------------ kemiripan */

/** Normalisasi untuk perbandingan duplikat persis. */
export const normalizeForCompare = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, " ").trim();

const wordSet = (s: string): Set<string> =>
  new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2)
  );

/** Kemiripan Jaccard antar kata (0..1). */
export function jaccard(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Ambang kemiripan: draf ≥ 80% mirip dengan postingan sebelumnya ditolak. */
export const SIMILARITY_LIMIT = 0.8;

export const isTooSimilar = (text: string, others: string[]): boolean =>
  others.some((o) => jaccard(text, o) >= SIMILARITY_LIMIT);
