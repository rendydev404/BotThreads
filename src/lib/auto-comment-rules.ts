/**
 * Auto Komentar: aturan murni (tanpa I/O), dipakai mesin (auto-comment.ts), route, uji, dan UI.
 *
 * Batas yang menyangkut database bersama (satu komentar per posting, cooldown penulis, jeda, batas harian)
 * ditegakkan ATOMIK di SQL (sql/043_auto_comment.sql, dash_acmt_claim/approve). Di sini: nilai batas,
 * validasi pengaturan, jadwal jam bebas, saringan kandidat, validasi komentar, dan aturan peran.
 */
import { DEFAULT_BANNED_TERMS, bannedHits } from "./autopilot-gate";
import { HARD_NEWS_TERMS } from "./radar-sources";
import type { Role } from "./request-ctx";
import { wibAt, wibDayKey } from "./scheduling";

/* ------------------------------------------------------------------ batas */

export const AUTO_COMMENT_MODES = ["MATI", "TINJAU", "OTOMATIS"] as const;
export type AutoCommentMode = (typeof AUTO_COMMENT_MODES)[number];

/** Jam yang terlewat tick masih boleh jalan sampai 2 jam setelahnya; lewat dari itu dilewati. */
export const SLOT_WINDOW_MS = 2 * 60 * 60 * 1000;
export const SLOTS_MIN = 1;
export const SLOTS_MAX = 12;
export const KEYWORDS_MIN = 1;
export const KEYWORDS_MAX = 20;
export const KEYWORD_MIN_CHARS = 2;
export const KEYWORD_MAX_CHARS = 60;
export const DAILY_CAP_DEFAULT = 3;
export const DAILY_CAP_MAX = 12;
/** Jeda minimal antar-komentar satu akun (tetap, tidak bisa diubah). */
export const ACCOUNT_GAP_MIN = 30;
export const WS_GAP_DEFAULT = 15;
export const WS_GAP_MIN = 10;
export const WS_GAP_MAX = 1440;
export const COOLDOWN_DEFAULT = 30;
export const COOLDOWN_MIN = 14;
export const COOLDOWN_MAX = 365;
export const POST_AGE_DEFAULT = 24;
export const POST_AGE_MIN = 1;
export const POST_AGE_MAX = 72;
export const BLOCK_LIST_MAX = 500;
/** Per putaran satu jam: paling banyak 2 pencarian kata kunci dan 3 draf AI. */
export const SEARCHES_PER_RUN = 2;
export const DRAFTS_PER_RUN = 3;
export const MIN_POST_CHARS = 20;
export const EXCERPT_MAX = 300;
export const COMMENT_MAX = 280;

/** Contoh jam (bukan preset): pemilik bebas memilih menit apa pun. */
export const SLOT_SUGGESTIONS = ["07:40", "09:15", "12:20", "16:50", "19:35", "21:10"];

export const OWN_ONLY_NOTE =
  "Belum ada postingan publik yang cocok. Sebelum izin pencarian disetujui Meta, pencarian hanya mengembalikan posting akun sendiri.";

/* ------------------------------------------------------------------ bentuk data (dibagi dengan UI) */

export interface AutoCommentConfig {
  aktif: boolean;
  gapMinutes: number;
  cooldownDays: number;
  maxPostAgeHours: number;
  blockList: string[];
}

export const DEFAULT_CONFIG: AutoCommentConfig = {
  aktif: false,
  gapMinutes: WS_GAP_DEFAULT,
  cooldownDays: COOLDOWN_DEFAULT,
  maxPostAgeHours: POST_AGE_DEFAULT,
  blockList: [],
};

export interface AutoCommentAccountSettings {
  mode: AutoCommentMode;
  slots: string[];
  keywords: string[];
  dailyCap: number;
}

export type TargetStatus = "DILEWATI" | "DRAF" | "DITOLAK" | "MENGIRIM" | "TERKIRIM" | "GAGAL";

/** Alasan penolakan klaim dari SQL (dash_acmt_claim / dash_acmt_approve). */
export type ClaimReason =
  | "TIDAK_VALID"
  | "MATI"
  | "BUKAN_OTOMATIS"
  | "BATAS_HARIAN"
  | "JEDA_AKUN"
  | "JEDA_WORKSPACE"
  | "COOLDOWN_PENULIS"
  | "SUDAH_DIKOMENTARI"
  | "TIDAK_DITEMUKAN"
  | "BUKAN_DRAF";

export const CLAIM_REASON_TEXT: Record<ClaimReason, string> = {
  TIDAK_VALID: "Komentar tidak valid.",
  MATI: "Auto Komentar sedang mati untuk akun atau workspace ini.",
  BUKAN_OTOMATIS: "Mode akun bukan Otomatis.",
  BATAS_HARIAN: "Batas komentar harian akun ini sudah tercapai.",
  JEDA_AKUN: "Akun ini baru saja berkomentar. Jeda minimal 30 menit per akun.",
  JEDA_WORKSPACE: "Workspace ini baru saja berkomentar. Tunggu sampai jeda antar-komentar workspace lewat.",
  COOLDOWN_PENULIS: "Penulis ini baru saja menerima auto komentar dari akun BotThreads (cooldown).",
  SUDAH_DIKOMENTARI: "Postingan ini sudah dikomentari akun BotThreads.",
  TIDAK_DITEMUKAN: "Draf tidak ditemukan.",
  BUKAN_DRAF: "Draf ini sudah diproses.",
};

/* ------------------------------------------------------------------ jadwal jam bebas */

const SLOT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "9:5" / "09.05" / "0905" -> "09:05"; null bila bukan jam yang sah. */
export function normalizeSlot(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const out = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  return SLOT_RE.test(out) ? out : null;
}

export interface DueSlot {
  /** Hari WIB pemilik jam ini ("YYYY-MM-DD"); jam 23:30 yang dijalankan 00:10 tetap milik kemarin. */
  dayKey: string;
  slot: string;
  at: Date;
}

/**
 * Jam yang sedang jatuh tempo: sudah lewat, paling lama 2 jam yang lalu, dan belum dijalankan pada hari WIB-nya
 * (`done` berisi "YYYY-MM-DD|HH:MM"). Bila beberapa jatuh tempo, yang paling awal dulu. Murni.
 */
export function dueSlot(slots: string[], now: Date, done: ReadonlySet<string>): DueSlot | null {
  let best: DueSlot | null = null;
  for (const raw of slots) {
    const slot = normalizeSlot(raw);
    if (!slot) continue;
    const [h, m] = slot.split(":").map(Number);
    for (const offset of [-1, 0]) {
      const at = wibAt(now, offset, h, m);
      const age = now.getTime() - at.getTime();
      if (age < 0 || age >= SLOT_WINDOW_MS) continue;
      const dayKey = wibDayKey(at);
      if (done.has(`${dayKey}|${slot}`)) continue;
      if (!best || at < best.at) best = { dayKey, slot, at };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ validasi pengaturan */

type Fail = { ok: false; error: string };

export function normalizeSlots(input: unknown): { ok: true; slots: string[] } | Fail {
  if (!Array.isArray(input)) return { ok: false, error: "Daftar jam tidak valid." };
  const out = new Set<string>();
  for (const raw of input) {
    const s = normalizeSlot(raw);
    if (!s) return { ok: false, error: "Jam harus berformat JJ:MM (00:00 sampai 23:59)." };
    out.add(s);
  }
  if (out.size > SLOTS_MAX) return { ok: false, error: `Paling banyak ${SLOTS_MAX} jam per hari.` };
  return { ok: true, slots: [...out].sort() };
}

export function normalizeKeywords(input: unknown): { ok: true; keywords: string[] } | Fail {
  if (!Array.isArray(input)) return { ok: false, error: "Daftar kata kunci tidak valid." };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return { ok: false, error: "Daftar kata kunci tidak valid." };
    const kw = raw.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
    if (!kw) continue;
    if ([...kw].length < KEYWORD_MIN_CHARS || [...kw].length > KEYWORD_MAX_CHARS) {
      return { ok: false, error: `Kata kunci ${KEYWORD_MIN_CHARS}-${KEYWORD_MAX_CHARS} karakter.` };
    }
    if (seen.has(kw.toLowerCase())) continue;
    seen.add(kw.toLowerCase());
    out.push(kw);
  }
  if (out.length > KEYWORDS_MAX) return { ok: false, error: `Paling banyak ${KEYWORDS_MAX} kata kunci.` };
  return { ok: true, keywords: out };
}

const isMode = (v: unknown): v is AutoCommentMode => typeof v === "string" && (AUTO_COMMENT_MODES as readonly string[]).includes(v);
const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Pengaturan akun dari body permintaan. Akun yang menyala wajib punya 1-12 jam dan 1-20 kata kunci. */
export function parseAccountSettings(body: unknown): { ok: true; value: AutoCommentAccountSettings } | Fail {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isMode(b.mode)) return { ok: false, error: "Mode tidak valid." };
  const slots = normalizeSlots(b.slots ?? []);
  if (!slots.ok) return slots;
  const keywords = normalizeKeywords(b.keywords ?? []);
  if (!keywords.ok) return keywords;
  const dailyCap = b.dailyCap === undefined ? DAILY_CAP_DEFAULT : intIn(b.dailyCap, 1, DAILY_CAP_MAX);
  if (dailyCap === null) return { ok: false, error: `Batas harian 1-${DAILY_CAP_MAX} komentar.` };
  if (b.mode !== "MATI") {
    if (slots.slots.length < SLOTS_MIN) return { ok: false, error: "Tambahkan minimal satu jam." };
    if (keywords.keywords.length < KEYWORDS_MIN) return { ok: false, error: "Tambahkan minimal satu kata kunci." };
  }
  return { ok: true, value: { mode: b.mode, slots: slots.slots, keywords: keywords.keywords, dailyCap } };
}

/** "@Nama.Akun " -> "nama.akun"; null bila bukan username Threads yang sah. */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(u) ? u : null;
}

export function parseWorkspaceConfig(body: unknown): { ok: true; value: AutoCommentConfig } | Fail {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.aktif !== "boolean") return { ok: false, error: "Status saklar tidak valid." };
  const gapMinutes = intIn(b.gapMinutes, WS_GAP_MIN, WS_GAP_MAX);
  if (gapMinutes === null) return { ok: false, error: `Jeda antar-komentar workspace ${WS_GAP_MIN}-${WS_GAP_MAX} menit.` };
  const cooldownDays = intIn(b.cooldownDays, COOLDOWN_MIN, COOLDOWN_MAX);
  if (cooldownDays === null) return { ok: false, error: `Cooldown penulis ${COOLDOWN_MIN}-${COOLDOWN_MAX} hari.` };
  const maxPostAgeHours = intIn(b.maxPostAgeHours, POST_AGE_MIN, POST_AGE_MAX);
  if (maxPostAgeHours === null) return { ok: false, error: `Umur postingan ${POST_AGE_MIN}-${POST_AGE_MAX} jam.` };
  if (!Array.isArray(b.blockList ?? [])) return { ok: false, error: "Daftar blokir tidak valid." };
  const block = new Set<string>();
  for (const raw of (b.blockList ?? []) as unknown[]) {
    if (typeof raw === "string" && !raw.trim()) continue;
    const u = normalizeUsername(raw);
    if (!u) return { ok: false, error: "Username di daftar blokir tidak valid." };
    block.add(u);
  }
  if (block.size > BLOCK_LIST_MAX) return { ok: false, error: `Daftar blokir paling banyak ${BLOCK_LIST_MAX} username.` };
  return { ok: true, value: { aktif: b.aktif, gapMinutes, cooldownDays, maxPostAgeHours, blockList: [...block].sort() } };
}

/* ------------------------------------------------------------------ peran */

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };

/**
 * Peran minimal untuk menyimpan pengaturan akun: menyalakan OTOMATIS (atau mengubah akun yang sedang OTOMATIS,
 * karena kata kunci dan jamnya langsung menentukan apa yang terkirim) hanya Admin/Pemilik; selebihnya Editor.
 */
export function roleForAccountChange(current: AutoCommentMode, next: AutoCommentMode): Role {
  return current === "OTOMATIS" || next === "OTOMATIS" ? "ADMIN" : "EDITOR";
}

export const roleAtLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

/** Aturan workspace (saklar, jeda, cooldown, blokir): Admin/Pemilik. Tinjau draf dan jalankan sekarang: Editor. */
export const ROLE_WORKSPACE_CONFIG: Role = "ADMIN";
export const ROLE_REVIEW: Role = "EDITOR";
export const ROLE_RUN_NOW: Role = "EDITOR";

/* ------------------------------------------------------------------ jeda dan batas (pra-cek; SQL yang memutuskan) */

export type GateReason = "BATAS_HARIAN" | "JEDA_AKUN" | "JEDA_WORKSPACE";

/**
 * Pra-cek sebelum memanggil API (hemat kuota pencarian dan AI). `sends` = mode OTOMATIS: jeda hanya berlaku
 * untuk komentar yang benar-benar dikirim; draf mode TINJAU hanya dibatasi batas harian.
 */
export function gateReason(s: {
  used: number;
  dailyCap: number;
  lastAt: Date | null;
  wsLastAt: Date | null;
  gapMinutes: number;
  sends: boolean;
  now: Date;
}): GateReason | null {
  if (s.used >= s.dailyCap) return "BATAS_HARIAN";
  if (!s.sends) return null;
  const t = s.now.getTime();
  if (s.lastAt && t - s.lastAt.getTime() < ACCOUNT_GAP_MIN * 60_000) return "JEDA_AKUN";
  if (s.wsLastAt && t - s.wsLastAt.getTime() < Math.max(s.gapMinutes, WS_GAP_MIN) * 60_000) return "JEDA_WORKSPACE";
  return null;
}

/** Batas bawah cooldown penulis (tidak pernah kurang dari 14 hari). */
export const cooldownSince = (now: Date, days: number): Date =>
  new Date(now.getTime() - Math.max(days, COOLDOWN_MIN) * 24 * 60 * 60 * 1000);

/* ------------------------------------------------------------------ saringan kandidat */

/** Topik yang tidak pantas dikomentari brand: keluhan, duka, kesehatan, anak, iklan pihak lain. */
export const AUTO_COMMENT_SKIP_TERMS = [
  "innalillahi", "inna lillahi", "rip", "wafat", "meninggal", "almarhum", "almarhumah", "duka", "berpulang",
  "rumah sakit", "dirawat", "opname", "diagnosa", "kanker", "tumor", "depresi", "kesehatan mental", "obat", "dokter",
  "komplain", "kecewa banget", "refund", "penipu", "ditipu", "scam", "viralkan",
  "anak saya", "anakku", "bayi", "balita", "siswa sd", "di bawah umur",
  "promo", "diskon", "giveaway", "open order", "open po", "dijual", "jual murah", "link di bio", "cek bio", "endorse",
  "agama", "politik", "18+", "nsfw",
];

export interface SearchPost {
  id: string;
  username: string;
  text: string;
  permalink: string | null;
  timestamp: string | null;
  isReply?: boolean;
  keyword: string;
}

export interface CandidateCtx {
  now: Date;
  ownUsername: string;
  maxPostAgeHours: number;
  blockList: ReadonlySet<string>;
  /** Username semua akun yang terhubung ke BotThreads (bila sudah diketahui). */
  botUsernames?: ReadonlySet<string>;
  bannedTerms?: string[];
}

/** "2026-10-19T02:55:00+0000" -> Date; null bila tidak terbaca. */
export function parseThreadsTime(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Alasan kandidat dilewati; null = layak dipertimbangkan AI. Urutan pemeriksaan = urutan biaya. */
export function candidateSkipReason(p: SearchPost, ctx: CandidateCtx): string | null {
  const author = p.username.toLowerCase();
  if (author === ctx.ownUsername.toLowerCase()) return "Postingan akun sendiri.";
  if (p.isReply) return "Balasan, bukan postingan utama.";
  if (ctx.botUsernames?.has(author)) return "Penulisnya akun BotThreads.";
  if (ctx.blockList.has(author)) return "Penulis ada di daftar blokir.";
  if (!p.permalink) return "Tanpa tautan postingan.";
  const at = parseThreadsTime(p.timestamp);
  if (!at || ctx.now.getTime() - at.getTime() > Math.min(Math.max(ctx.maxPostAgeHours, POST_AGE_MIN), POST_AGE_MAX) * 3_600_000) {
    return "Postingan terlalu lama.";
  }
  if ([...p.text.trim()].length < MIN_POST_CHARS) return "Teks postingan terlalu pendek.";
  const banned = [...DEFAULT_BANNED_TERMS, ...HARD_NEWS_TERMS, ...AUTO_COMMENT_SKIP_TERMS, ...(ctx.bannedTerms ?? [])];
  if (bannedHits(p.text, banned).length) return "Topik sensitif atau promosi.";
  return null;
}

export interface FilterResult {
  eligible: SearchPost[];
  skipped: { post: SearchPost; reason: string }[];
  /** Semua hasil milik akun sendiri: izin pencarian publik belum disetujui Meta. */
  ownOnly: boolean;
}

/**
 * Saring hasil pencarian: duplikat dibuang, satu kandidat per penulis, terbaru dulu. Posting akun sendiri tidak
 * dicatat (bukan kandidat), selebihnya yang dilewati dikembalikan bersama alasannya untuk log.
 */
export function filterCandidates(posts: SearchPost[], ctx: CandidateCtx): FilterResult {
  const own = ctx.ownUsername.toLowerCase();
  const byId = new Map<string, SearchPost>();
  for (const p of posts) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
  const unique = [...byId.values()];
  const ownOnly = unique.length > 0 && unique.every((p) => p.username.toLowerCase() === own);
  const eligible: SearchPost[] = [];
  const skipped: FilterResult["skipped"] = [];
  const authors = new Set<string>();
  const time = (p: SearchPost) => parseThreadsTime(p.timestamp)?.getTime() ?? 0;
  for (const p of unique.sort((a, b) => time(b) - time(a))) {
    const reason = candidateSkipReason(p, ctx);
    if (reason === "Postingan akun sendiri.") continue;
    if (reason) skipped.push({ post: p, reason });
    else if (authors.has(p.username.toLowerCase())) continue;
    else {
      authors.add(p.username.toLowerCase());
      eligible.push(p);
    }
  }
  return { eligible, skipped, ownOnly };
}

/** Kata kunci untuk satu putaran (paling banyak 2), bergilir menurut `seed` supaya semua kata kunci terpakai. */
export function pickKeywords(keywords: string[], seed: string, n = SEARCHES_PER_RUN): string[] {
  if (keywords.length <= n) return [...keywords];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = h % keywords.length;
  return Array.from({ length: n }, (_, i) => keywords[(start + i) % keywords.length]);
}

/* ------------------------------------------------------------------ validasi komentar */

const URL_LIKE = /https?:\/\/|www\.|(?<![\p{L}\p{N}@])[\p{L}\p{N}-]+\.(?:com|co\.id|id|net|org|ly|me|shop|link|ee|io|app|xyz|store)(?![\p{L}\p{N}])/iu;
const MONEY = /\d[\d.,]*\s*(?:rb|k|ribu|jt|juta)(?![\p{L}])|(?<![\p{L}])rp\.?(?![\p{L}])/iu;
const AI_WORDS = /(?<![\p{L}\p{N}])(?:ai|a\.i\.|bot|chatgpt|gpt|robot|otomatis|automated)(?![\p{L}\p{N}])/iu;
const CODE = /`|=>|\b\w+\.\w+\([^)]*\)|[;{}][ \t]*$|<\/?[a-z][a-z0-9]*[\s>/]/im;
/** Ajakan, promosi, dan klaim menjadi orang lain. */
const FORBIDDEN_PHRASES = [
  "cek bio", "link di bio", "link in bio", "dm", "dm aja", "dm ya", "inbox", "order", "pesan sekarang", "mampir", "follow",
  "kunjungi", "klik", "checkout", "promo", "diskon", "gratis", "voucher", "cashback", "giveaway", "harga", "murah",
  "sebagai pelanggan", "pelanggan setia", "aku pelanggan", "saya pelanggan", "tetanggaku", "tetangga saya", "temanku kerja di",
];

export type CommentCheck = { ok: true; text: string } | { ok: false; reason: string };

/** Validasi server untuk komentar AI atau hasil suntingan peninjau. Gagal = tidak pernah dikirim. */
export function validateComment(raw: unknown): CommentCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Komentar kosong." };
  const text = raw
    .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { ok: false, reason: "Komentar kosong." };
  if ([...text].length > COMMENT_MAX) return { ok: false, reason: "Komentar lebih dari 280 karakter." };
  if (URL_LIKE.test(text)) return { ok: false, reason: "Komentar memuat link." };
  if (text.includes("@")) return { ok: false, reason: "Komentar memuat mention." };
  if (text.includes("#")) return { ok: false, reason: "Komentar memuat hashtag." };
  if (MONEY.test(text)) return { ok: false, reason: "Komentar memuat harga." };
  if (AI_WORDS.test(text)) return { ok: false, reason: "Komentar menyebut AI atau bot." };
  if (CODE.test(text)) return { ok: false, reason: "Komentar memuat kode." };
  if (bannedHits(text, FORBIDDEN_PHRASES).length) return { ok: false, reason: "Komentar memuat promosi atau ajakan." };
  if ((text.match(/[.!?]+(?=\s|$)/g) ?? []).length > 3) return { ok: false, reason: "Komentar terlalu panjang." };
  return { ok: true, text };
}
