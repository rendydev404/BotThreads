/**
 * Cakupan akun untuk permintaan konten di chat (murni, tanpa I/O).
 *
 * Aturan: "semua/seluruh/tiap akun" berarti SEMUA akun (dikerjakan Multi-Agent Orchestrator, satu
 * agen per akun). Beberapa akun disebut berarti akun-akun itu saja. Bila cakupan tidak jelas, asisten
 * bertanya lewat dialog, bukan memilih sebagian akun sendiri. Balasan pendek seperti "untuk semua
 * akun" setelah permintaan konten dibaca sebagai lanjutan permintaan itu.
 */
import { MAX_BRIEF_CHARS } from "./content-validation";
import {
  findMentionedAccounts,
  isOrchestratorIntent,
  parseDraftIntent,
  parseHour,
  parsePublishIntent,
  type PublishIntent,
} from "./content-intent";
import type { PublishAccount } from "./publish-accounts";

export interface ChatTurn {
  sender: "user" | "bot";
  text: string;
}

export interface ScopePreset {
  /** null = semua akun. */
  accountIds: string[] | null;
  topic: string;
  /** "HH:MM" WIB bila pengguna menyebut jam, selain itu null (jam ramai tiap akun). */
  time: string | null;
  /** Perintah posting eksplisit: AI langsung memasukkan hasilnya ke antrean; null = draf saja. */
  publish: PublishIntent | null;
}

export type ContentScope =
  | ({ kind: "all" } & ScopePreset)
  | ({ kind: "accounts" } & ScopePreset)
  | ({ kind: "ask" } & Omit<ScopePreset, "accountIds">)
  /** Satu akun / revisi draf: tetap lewat jalur draf atau jawaban AI biasa. */
  | { kind: "single"; publish: PublishIntent | null };

const ALL_ACCOUNTS =
  /\b(?:semua|seluruh|tiap|setiap|masing[- ]?masing|masing2)\s+(?:akun|cabang|outlet|acc)(?:nya)?\b|\bsemua(?:nya)?\s+(?:aja|saja)\b|\ball\s+(?:akun|account)s?\b/i;
/** Kata "semua" tanpa kata akun, hanya diterima pada balasan lanjutan yang pendek. */
const BARE_ALL = /\b(?:semua(?:nya)?|seluruh(?:nya)?|all)\b/i;
const SOME_ACCOUNTS = /\b(?:beberapa|sebagian)\s+(?:akun|cabang|outlet)\b/i;

const CONTENT_VERB =
  /\b(buat(?:kan|in)?|bikin(?:kan|in)?|tulis(?:kan|in)?|susun(?:kan)?|rekomendasi(?:kan)?|saran(?:kan)?|jadwalkan|ide|racik|generate|kasih(?:in)?(?:\s+\d+)?\s+(?:ide|contoh|draf|draft|konten))\b/i;
const CONTENT_NOUN = /\b(draf|draft|konten|caption|postingan|posting|post|hook|ide|thread|threads|prompt)\b/i;
const HOWTO = /\b(cara|bagaimana|gimana|kenapa|mengapa|apa itu|berapa|siapa)\b/i;

/** Permintaan membuat konten (bukan pertanyaan analitik atau "cara ..."). */
export function isContentRequest(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 600 || HOWTO.test(t)) return false;
  return isOrchestratorIntent(t) || (CONTENT_VERB.test(t) && CONTENT_NOUN.test(t)) || parsePublishIntent(t) !== null;
}

/**
 * Konteks percakapan konten: aktif bila giliran bot terakhir berisi ide/draf/dialog cakupan atau ada
 * permintaan konten dari pengguna dalam 6 giliran terakhir. `request` = permintaan konten terakhir itu.
 */
function contentContext(history: ChatTurn[]): { active: boolean; request: string } {
  const request = [...history.slice(-6)].reverse().find((h) => h.sender === "user" && isContentRequest(h.text));
  const lastBot = [...history].reverse().find((h) => h.sender === "bot");
  const botContent = !!lastBot && /```ide|untuk akun mana|draf untuk|orchestrator/i.test(lastBot.text);
  return { active: !!request || botContent, request: request?.text ?? "" };
}

const TOPIC_LEAD = /\b(?:tentang|soal|mengenai|seputar|tema(?:nya)?|topik(?:nya)?|bahas(?:an)?)\s+(.+)/i;
const STOP = new RegExp(
  "\\b(?:" +
    [
      "buat(?:kan|in)?", "bikin(?:kan|in)?", "tulis(?:kan|in)?", "susun(?:kan)?", "rekomendasi(?:kan)?", "saran(?:kan)?",
      "jadwalkan", "racik", "kasih", "generate", "ide", "draf", "draft", "konten", "caption", "postingan", "posting",
      "post", "hook", "thread", "threads", "untuk", "utk", "ke", "di", "dong", "ya", "yg", "yang", "nya", "tolong",
      "coba", "aja", "saja", "juga", "sekarang", "besok", "lusa", "hari", "ini", "jam", "pagi", "siang", "sore",
      "malam", "satu", "dua", "tiga", "empat", "lima", "akun", "cabang", "outlet", "semua(?:nya)?", "seluruh(?:nya)?",
      "tiap", "setiap", "beberapa", "sebagian", "lagi", "contoh", "gitu", "kayak", "kyk", "mau", "minta", "aku",
      "saya", "gue", "gw", "lu", "lo", "kamu", "orchestrator", "multi", "agent", "agen", "sekaligus", "masing",
      "masing-masing", "all", "the", "sama", "dan", "atau", "dengan", "pake", "pakai", "dari", "berdasarkan", "terbaik",
      "paling", "bagus", "menarik", "keren", "minggu", "bulan", "sekarang", "langsung", "jadwal(?:kan|in)?",
      "terjadwal", "terbit(?:kan)?", "upload", "unggah", "publish", "tayang(?:kan)?", "posting(?:kan|in)?",
    ].join("|") +
    ")\\b",
  "gi"
);

/** Topik/arahan isi dari pesan; kosong bila pesan hanya berisi perintah umum ("buat ide konten"). */
export function extractTopic(text: string): string {
  let t = text.replace(new RegExp(ALL_ACCOUNTS.source, "gi"), " ").replace(/@[\w.]+/g, " ");
  const lead = TOPIC_LEAD.exec(t);
  t = (lead ? lead[1] : t.replace(STOP, " ")).replace(/\b\d+\b/g, " ");
  t = t
    .replace(/\b(?:untuk|utk|buat)\s*$/i, " ")
    .replace(/[^\p{L}\p{N}\s'".,-]/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,-]+|[\s.,-]+$/g, "");
  return (lead ? t.length >= 2 : t.split(" ").length >= 2) ? t.slice(0, MAX_BRIEF_CHARS) : "";
}

const hhmm = (text: string): string | null => {
  const h = parseHour(text);
  return h === null ? null : `${String(h).padStart(2, "0")}:00`;
};

/**
 * Null bila pesan bukan permintaan konten. `accountFilter` = filter akun di chat ("all"/username).
 */
export function resolveContentScope(opts: {
  text: string;
  history: ChatTurn[];
  accounts: PublishAccount[];
  hasLastDrafts: boolean;
  accountFilter: string | null;
}): ContentScope | null {
  const text = opts.text.trim();
  const direct = isContentRequest(text);
  const ctx = direct ? null : contentContext(opts.history);
  const mentioned = findMentionedAccounts(text, opts.accounts);
  const followUp =
    !direct &&
    !!ctx?.active &&
    text.length <= 120 &&
    (ALL_ACCOUNTS.test(text) || BARE_ALL.test(text) || SOME_ACCOUNTS.test(text) || mentioned.length > 0);
  if (!direct && !followUp) return null;

  // Revisi draf yang sudah ada tetap lewat jalur draf.
  if (direct && parseDraftIntent(text, opts.hasLastDrafts)?.revise) return { kind: "single", publish: null };

  const prevText = ctx?.request ?? "";
  const topic = extractTopic(text) || (followUp ? extractTopic(prevText) : "");
  const time = hhmm(text) ?? (followUp ? hhmm(prevText) : null);
  const publish = parsePublishIntent(text) ?? (followUp ? parsePublishIntent(prevText) : null);

  if (ALL_ACCOUNTS.test(text) || (followUp && BARE_ALL.test(text) && !SOME_ACCOUNTS.test(text))) {
    return { kind: "all", accountIds: null, topic, time, publish };
  }
  if (mentioned.length >= 2 || (followUp && mentioned.length === 1)) {
    return { kind: "accounts", accountIds: mentioned.map((a) => a.id), topic, time, publish };
  }
  if (mentioned.length === 1) return { kind: "single", publish };
  if (!SOME_ACCOUNTS.test(text) && opts.accountFilter && opts.accountFilter !== "all") return { kind: "single", publish };
  return { kind: "ask", topic, time, publish };
}
